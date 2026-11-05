import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// Website allocations and eBay availability are distinct pools. A transfer to
// the website is not sellable until eBay has surrendered those copies.
export function createStockSyncStore(
  db: Database.Database,
  cards: () => any[],
) {
  db.exec(`CREATE TABLE IF NOT EXISTS stock_sync_jobs (
    card_id INTEGER PRIMARY KEY REFERENCES cards(id), status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '', verified_at TEXT, signature TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS shop_allocation_targets (card_id INTEGER PRIMARY KEY REFERENCES cards(id), quantity INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stock_listing_watermarks (key TEXT PRIMARY KEY, sold INTEGER NOT NULL, accounted INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stock_sync_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);`);
  const setting = (key: string) =>
    (db.prepare("SELECT value FROM ebay_settings WHERE key=?").get(key) as any)
      ?.value || "";
  const setSetting = (key: string, value: string) =>
    db
      .prepare(
        "INSERT INTO ebay_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  const enabled = () => setting("stockSyncEnabled") === "true";
  const lease = () =>
    db.prepare("SELECT * FROM stock_sync_lease WHERE id=1").get() as any;
  const assertIdle = () => {
    if (lease()?.expires > Date.now())
      throw new Error(
        "Stock synchronisation is running. Please try again shortly.",
      );
  };
  function assertOwner(owner: string) {
    const lock = lease();
    if (!lock || lock.owner !== owner || lock.expires <= Date.now())
      throw new Error("Stock synchronisation lock expired.");
    if (!enabled()) throw new Error("Stock synchronisation has been paused.");
    if (setting("accountDeleted"))
      throw new Error("This workspace seller account has been deleted.");
  }
  const acquire = db.transaction(() => {
    if (lease()?.expires > Date.now()) return null;
    const owner = randomUUID();
    db.prepare(
      "INSERT INTO stock_sync_lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires",
    ).run(owner, Date.now() + 120000);
    return owner;
  });
  function renew(owner: string) {
    assertOwner(owner);
    db.prepare("UPDATE stock_sync_lease SET expires=? WHERE owner=?").run(
      Date.now() + 120000,
      owner,
    );
  }
  const release = (owner: string) =>
    db.prepare("DELETE FROM stock_sync_lease WHERE owner=?").run(owner);
  const enqueue = (id: number) =>
    db
      .prepare(
        "INSERT INTO stock_sync_jobs(card_id) VALUES (?) ON CONFLICT(card_id) DO UPDATE SET status='pending',retry_at=0,error=''",
      )
      .run(id);
  const enqueueAll = () =>
    db
      .prepare(
        "INSERT INTO stock_sync_jobs(card_id) SELECT card_id FROM ebay_mappings UNION SELECT card_id FROM shop_allocation_targets WHERE true ON CONFLICT(card_id) DO NOTHING",
      )
      .run();
  const request = (id: number, quantity: number) => {
    db.prepare(
      "INSERT INTO shop_allocation_targets VALUES (?,?) ON CONFLICT(card_id) DO UPDATE SET quantity=excluded.quantity",
    ).run(id, quantity);
    enqueue(id);
  };
  function plan(id: number) {
    const card = cards().find((c) => c.id === id);
    if (!card) throw new Error("Inventory card not found.");
    const active = (
      db
        .prepare(
          "SELECT l.key,l.payload,m.card_id FROM ebay_listings l LEFT JOIN ebay_mappings m ON m.key=l.key WHERE l.active=1",
        )
        .all() as any[]
    ).map((l) => ({ ...JSON.parse(l.payload), cardId: l.card_id }));
    const listings = active
      .filter((l) => l.cardId === id)
      .sort((a, b) => a.key.localeCompare(b.key));
    const current =
      (
        db
          .prepare("SELECT quantity FROM shop_listings WHERE card_id=?")
          .get(id) as any
      )?.quantity || 0;
    const requested =
      (
        db
          .prepare(
            "SELECT quantity FROM shop_allocation_targets WHERE card_id=?",
          )
          .get(id) as any
      )?.quantity ?? current;
    const held = (
      db
        .prepare(
          "SELECT COALESCE(SUM(i.quantity),0) n FROM shop_order_items i JOIN shop_orders o ON o.id=i.order_id WHERE i.card_id=? AND o.status='pending'",
        )
        .get(id) as any
    ).n;
    const orders = db
      .prepare(
        "SELECT o.payload,o.disposition,o.issue,o.sale_id FROM ebay_orders o",
      )
      .all() as any[];
    const unresolved = orders.some((row) => {
      const o = JSON.parse(row.payload);
      const matched = listings.some(
        (l) =>
          l.itemId === o.itemId &&
          l.sku === o.sku &&
          (!l.variation || l.variation === o.variation),
      );
      return (
        matched &&
        (row.issue ||
          (row.disposition === "review" && o.created >= setting("autoSince")))
      );
    });
    const saleGap = listings.some((l) => {
      const old = db
        .prepare("SELECT * FROM stock_listing_watermarks WHERE key=?")
        .get(l.key) as any;
      const accounted = orders.reduce((n, row) => {
        const o = JSON.parse(row.payload);
        return (
          n +
          (o.itemId === l.itemId &&
          o.sku === l.sku &&
          (!l.variation || o.variation === l.variation) &&
          (row.sale_id || row.disposition === "already-counted")
            ? o.quantity
            : 0)
        );
      }, 0);
      return (
        old &&
        (l.sold === undefined ||
          l.sold - old.sold !== accounted - old.accounted)
      );
    });
    const unmapped = active.filter((l) => !l.cardId).length;
    const target = Math.max(0, card.stock - Math.max(requested, current, held));
    let blocked = "";
    if (listings.some((l) => l.variation))
      blocked = "Variation listing needs a reviewed SKU allocation.";
    else if (saleGap)
      blocked =
        "eBay sold count is not yet accounted for in inventory. Waiting for order reconciliation.";
    else if (unresolved)
      blocked =
        "Resolve eBay order issues for this card before transferring website stock.";
    else if (requested > card.stock || requested < held)
      blocked =
        "Website allocation conflicts with physical stock or checkout holds.";
    else if (requested > 0 && unmapped)
      blocked = `Match the ${unmapped} unmapped eBay listings before releasing additional website stock.`;
    const signature = JSON.stringify({
      stock: card.stock,
      current,
      requested,
      held,
      listings: listings.map((l) => [l.key, l.available, l.sold]),
      blocked,
    });
    return {
      cardId: id,
      stock: card.stock,
      current,
      requested,
      held,
      listings,
      target,
      blocked,
      signature,
    };
  }
  const observe = db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT l.key,l.payload FROM ebay_listings l JOIN ebay_mappings m ON m.key=l.key WHERE l.active=1",
      )
      .all() as any[];
    const orders = db
      .prepare("SELECT payload,sale_id,disposition FROM ebay_orders")
      .all() as any[];
    for (const row of rows) {
      const l = JSON.parse(row.payload);
      if (!Number.isSafeInteger(l.sold)) continue;
      const accounted = orders.reduce((n, row) => {
        const o = JSON.parse(row.payload);
        return (
          n +
          (o.itemId === l.itemId &&
          o.sku === l.sku &&
          (!l.variation || o.variation === l.variation) &&
          (row.sale_id || row.disposition === "already-counted")
            ? o.quantity
            : 0)
        );
      }, 0);
      const old = db
        .prepare("SELECT * FROM stock_listing_watermarks WHERE key=?")
        .get(row.key) as any;
      if (!old || l.sold - old.sold === accounted - old.accounted)
        db.prepare(
          "INSERT INTO stock_listing_watermarks VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET sold=excluded.sold,accounted=excluded.accounted",
        ).run(row.key, l.sold, accounted);
    }
  });
  const activate = db.transaction((id: number, owner: string) => {
    assertOwner(owner);
    const p = plan(id);
    if (p.blocked) throw new Error(p.blocked);
    db.prepare("UPDATE shop_listings SET quantity=? WHERE card_id=?").run(
      p.requested,
      id,
    );
  });
  const sold = (id: number, quantity: number) => {
    db.prepare(
      "UPDATE shop_allocation_targets SET quantity=MAX(0,quantity-?) WHERE card_id=?",
    ).run(quantity, id);
    enqueue(id);
  };
  function usable(id: number) {
    if (setting("stockSyncPaused") === "true") return false;
    if (!enabled()) return true;
    const fresh =
      Date.now() - Date.parse(setting("stockSyncLastSuccess")) < 5 * 60 * 1000;
    const job = db
      .prepare("SELECT status FROM stock_sync_jobs WHERE card_id=?")
      .get(id) as any;
    return (
      fresh &&
      !!setting("autoSince") &&
      !setting("stockSyncError") &&
      !setting("lastError") &&
      !setting("notificationError") &&
      job?.status === "verified" &&
      !plan(id).blocked
    );
  }
  function finish(id: number, owner: string, status: string, error = "") {
    assertOwner(owner);
    const job = db
      .prepare("SELECT attempts FROM stock_sync_jobs WHERE card_id=?")
      .get(id) as any;
    const attempts = status === "verified" ? 0 : (job?.attempts || 0) + 1;
    const delay = Math.min(15 * 60 * 1000, 15000 * 2 ** Math.min(attempts, 6));
    db.prepare(
      "UPDATE stock_sync_jobs SET status=?,attempts=?,error=?,retry_at=?,verified_at=?,signature=? WHERE card_id=?",
    ).run(
      status,
      attempts,
      error,
      status === "verified" ? 0 : Date.now() + delay,
      status === "verified" ? new Date().toISOString() : null,
      plan(id).signature,
      id,
    );
  }
  const jobs = () =>
    db
      .prepare(
        "SELECT j.*,c.player,c.number,c.variant FROM stock_sync_jobs j JOIN cards c ON c.id=j.card_id ORDER BY j.card_id",
      )
      .all() as any[];
  const status = () => ({
    enabled: enabled(),
    paused: setting("stockSyncPaused") === "true",
    lastSuccess: setting("stockSyncLastSuccess"),
    lastError: setting("stockSyncError"),
    running: lease()?.expires > Date.now(),
    targets: db.prepare("SELECT * FROM shop_allocation_targets").all(),
    unmapped: (
      db
        .prepare(
          "SELECT COUNT(*) n FROM ebay_listings l LEFT JOIN ebay_mappings m ON m.key=l.key WHERE l.active=1 AND m.card_id IS NULL",
        )
        .get() as any
    ).n,
    jobs: jobs(),
  });
  const retryNow = () => {
    assertIdle();
    enqueueAll();
    db.prepare(
      "UPDATE stock_sync_jobs SET retry_at=0 WHERE status<>'verified'",
    ).run();
  };
  function enable() {
    assertIdle();
    if (!setting("tokens") || !setting("autoSince"))
      throw new Error(
        "Connect eBay and finish inventory stocktake before enabling stock sync.",
      );
    setSetting("stockSyncEnabled", "true");
    setSetting("stockSyncPaused", "false");
    retryNow();
  }
  const pause = () => {
    setSetting("stockSyncEnabled", "false");
    setSetting("stockSyncPaused", "true");
  };
  return {
    paused: () => setting("stockSyncPaused") === "true",
    pause,
    enabled,
    assertIdle,
    assertOwner,
    acquire,
    renew,
    release,
    enqueue,
    enqueueAll,
    request,
    sold,
    plan,
    observe,
    activate,
    usable,
    finish,
    jobs,
    status,
    enable,
    retryNow,
    setSetting,
  };
}
