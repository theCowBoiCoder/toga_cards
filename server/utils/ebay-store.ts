import type Database from "better-sqlite3";

export type EbayListing = {
  key: string;
  itemId: string;
  sku: string;
  title: string;
  available: number;
  sold?: number;
  variation: string;
};
export type EbayOrder = {
  key: string;
  orderId: string;
  itemId: string;
  sku: string;
  title: string;
  quantity: number;
  gross: number;
  currency: string;
  created: string;
  paid: boolean;
  cancelled: boolean;
  variation: string;
};
export const listingKey = (itemId: string, sku: string, variation = "") =>
  JSON.stringify([itemId, sku, sku ? "" : variation]);

export function createEbayStore(db: Database.Database, holdings: () => any[]) {
  db.pragma("secure_delete = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS ebay_stock_imports (listing_key TEXT PRIMARY KEY, quantity INTEGER NOT NULL, imported_at TEXT NOT NULL)",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS ebay_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ebay_listings (key TEXT PRIMARY KEY, payload TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS ebay_mappings (key TEXT PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id));
    CREATE TABLE IF NOT EXISTS ebay_orders (key TEXT PRIMARY KEY, payload TEXT NOT NULL, sale_id INTEGER REFERENCES sales(id), disposition TEXT NOT NULL DEFAULT 'review', issue TEXT NOT NULL DEFAULT '', fees_confirmed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ebay_baselines (card_id INTEGER PRIMARY KEY REFERENCES cards(id), since TEXT NOT NULL);`);
  const setting = (key: string) =>
    (db.prepare("SELECT value FROM ebay_settings WHERE key=?").get(key) as any)
      ?.value || "";
  const setSetting = (key: string, value: string) =>
    db
      .prepare(
        "INSERT INTO ebay_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  const deleteAccount = db.transaction(() => {
    // Keep physical holdings unchanged, without retaining eBay sale details.
    const sales = db
      .prepare(
        "SELECT s.* FROM sales s WHERE s.id IN (SELECT sale_id FROM ebay_orders WHERE sale_id IS NOT NULL)",
      )
      .all() as any[];
    for (const sale of sales)
      db.prepare(
        "INSERT INTO movements(card_id,quantity,total_cost,date) VALUES (?,?,?,?)",
      ).run(
        sale.card_id,
        -sale.quantity,
        -sale.cost,
        new Date().toISOString().slice(0, 10),
      );
    if (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_listing_watermarks'",
        )
        .get()
    )
      db.exec(
        "DELETE FROM stock_listing_watermarks; DELETE FROM stock_sync_jobs; DELETE FROM stock_sync_lease;",
      );
    db.exec(
      "DELETE FROM ebay_orders; DELETE FROM ebay_listings; DELETE FROM ebay_mappings; DELETE FROM ebay_baselines; DELETE FROM ebay_stock_imports;",
    );
    for (const sale of sales)
      db.prepare("DELETE FROM sales WHERE id=?").run(sale.id);
    db.prepare(
      "DELETE FROM ebay_settings WHERE key NOT IN ('ruName','notificationLastCheck','notificationError','notificationOldest')",
    ).run();
    setSetting("accountDeleted", "true");
    setSetting("deletionCleanupPending", "true");
  });
  function finishDeletionCleanup() {
    if (!setting("deletionCleanupPending")) return;
    db.exec("VACUUM");
    const result = db.pragma("wal_checkpoint(TRUNCATE)") as any[];
    if (result[0]?.busy) throw new Error("Deletion checkpoint busy");
    setSetting("deletionCleanupPending", "");
  }
  function processAccountDeletion(data: any) {
    if (
      !data ||
      !["username", "userId", "eiasToken"].some(
        (k) => typeof data[k] === "string" && data[k],
      )
    )
      throw new Error("Missing deletion identity");
    if (setting("accountDeleted")) {
      finishDeletionCleanup();
      return;
    }
    const seller = setting("seller"),
      eias = setting("sellerEias");
    if (!seller) {
      if (
        setting("tokens") ||
        (db.prepare("SELECT COUNT(*) n FROM ebay_orders").get() as any).n
      )
        throw new Error("Seller identity missing");
      return;
    }
    if (!eias) throw new Error("Seller identity needs refresh");
    if (
      data.eiasToken !== eias &&
      data.username !== seller &&
      data.userId !== seller
    )
      return;
    deleteAccount();
    finishDeletionCleanup();
  }
  const mapped = (key: string) =>
    (
      db
        .prepare("SELECT card_id FROM ebay_mappings WHERE key=?")
        .get(key) as any
    )?.card_id;
  const orderMapping = (order: EbayOrder) =>
    mapped(listingKey(order.itemId, order.sku, order.variation));
  const money = (n: unknown) => {
    if (!Number.isSafeInteger(n) || Number(n) < 0 || Number(n) > 100000000)
      throw new Error("Invalid eBay monetary amount.");
    return Number(n);
  };

  function apply(key: string, fees: number | null, historical = false) {
    const record = db
      .prepare("SELECT * FROM ebay_orders WHERE key=?")
      .get(key) as any;
    if (!record) throw new Error("Order not found.");
    if (record.sale_id || record.disposition === "already-counted") return;
    const order: EbayOrder = JSON.parse(record.payload);
    if (!order.paid || order.cancelled)
      throw new Error("Unpaid, cancelled or refunded orders require review.");
    if (order.currency !== "GBP")
      throw new Error("Only GBP sales can be applied.");
    const cardId = orderMapping(order);
    const card = holdings().find((card) => card.id === cardId);
    if (!card) throw new Error("Confirm a single-card listing match first.");
    const baseline = (
      db
        .prepare("SELECT since FROM ebay_baselines WHERE card_id=?")
        .get(cardId) as any
    )?.since;
    if (!historical && baseline && order.created <= baseline)
      throw new Error(
        "This sale predates the listed-stock baseline; review before deducting.",
      );
    const allocated =
      (
        db
          .prepare("SELECT quantity FROM shop_listings WHERE card_id=?")
          .get(cardId) as any
      )?.quantity || 0;
    if (allocated > 0 && card.stock - allocated < order.quantity)
      throw new Error(
        "Stock allocated to website; review channel allocations before applying eBay sale.",
      );
    if (card.stock < order.quantity)
      throw new Error(
        "Insufficient counted stock; finish counting this card before applying.",
      );
    const charge = fees === null ? 0 : money(fees);
    if (charge > order.gross) throw new Error("Fees exceed the sale amount.");
    const cost =
      order.quantity === card.stock
        ? card.stock_cost
        : Math.round((card.stock_cost / card.stock) * order.quantity);
    const sale = db
      .prepare(
        "INSERT INTO sales(card_id,quantity,gross,fees,cost,date,platform) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        card.id,
        order.quantity,
        money(order.gross),
        charge,
        cost,
        order.created.slice(0, 10),
        "eBay",
      );
    db.prepare(
      "UPDATE ebay_orders SET sale_id=?, disposition='applied',issue='',fees_confirmed=? WHERE key=?",
    ).run(sale.lastInsertRowid, fees === null ? 0 : 1, key);
  }

  const ingest = db.transaction(
    (listings: EbayListing[], orders: EbayOrder[], syncedAt: string) => {
      if (setting("accountDeleted"))
        throw new Error("This workspace seller account has been deleted.");
      if (new Set(listings.map((l) => l.key)).size !== listings.length)
        throw new Error(
          "Duplicate listing identities; snapshot was not applied.",
        );
      db.prepare("UPDATE ebay_listings SET active=0").run();
      const putListing = db.prepare(
        "INSERT INTO ebay_listings(key,payload,active) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,active=1",
      );
      listings.forEach((listing) =>
        putListing.run(listing.key, JSON.stringify(listing)),
      );
      for (const order of orders) {
        const old = db
          .prepare("SELECT * FROM ebay_orders WHERE key=?")
          .get(order.key) as any;
        const changed =
          old?.sale_id &&
          (() => {
            const previous = JSON.parse(old.payload);
            return (
              previous.gross !== order.gross ||
              previous.quantity !== order.quantity ||
              previous.currency !== order.currency ||
              order.cancelled ||
              !order.paid
            );
          })();
        db.prepare(
          "INSERT INTO ebay_orders(key,payload) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
        ).run(order.key, JSON.stringify(order));
        if (changed)
          db.prepare(
            "UPDATE ebay_orders SET issue='Order changed or refunded after import. Review the recorded sale; no automatic restock.' WHERE key=?",
          ).run(order.key);
      }
      const autoSince = setting("autoSince");
      if (autoSince) {
        const pending = db
          .prepare(
            "SELECT key,payload FROM ebay_orders WHERE disposition='review'",
          )
          .all() as any[];
        for (const row of pending) {
          const order = JSON.parse(row.payload);
          if (order.created < autoSince) continue;
          try {
            apply(row.key, null);
          } catch (error) {
            db.prepare("UPDATE ebay_orders SET issue=? WHERE key=?").run(
              (error as Error).message,
              row.key,
            );
          }
        }
      }
      setSetting("lastSync", syncedAt);
      setSetting("lastError", "");
    },
  );

  function snapshot() {
    const cards = holdings();
    const listings = (
      db
        .prepare("SELECT * FROM ebay_listings ORDER BY active DESC,key")
        .all() as any[]
    ).map((row) => ({
      ...JSON.parse(row.payload),
      active: !!row.active,
      cardId: mapped(row.key) || null,
    }));
    const orders = (
      db
        .prepare(
          "SELECT * FROM ebay_orders ORDER BY json_extract(payload,'$.created') DESC",
        )
        .all() as any[]
    ).map((row) => ({
      ...JSON.parse(row.payload),
      cardId: orderMapping(JSON.parse(row.payload)) || null,
      saleId: row.sale_id,
      disposition: row.disposition,
      issue: row.issue,
      feesConfirmed: !!row.fees_confirmed,
    }));
    const quantities = new Map<number, number>();
    const pending = new Map<number, number>();
    const imported = new Set(
      (
        db.prepare("SELECT listing_key FROM ebay_stock_imports").all() as any[]
      ).map((row) => row.listing_key),
    );
    for (const row of listings.filter(
      (row) => row.active && row.cardId && !imported.has(row.key),
    )) {
      pending.set(row.cardId, (pending.get(row.cardId) || 0) + row.available);
    }
    listings
      .filter((row) => row.active && row.cardId)
      .forEach((row) =>
        quantities.set(
          row.cardId,
          (quantities.get(row.cardId) || 0) + row.available,
        ),
      );
    return {
      listings,
      orders,
      reconciliation: [...quantities].map(([cardId, listed]) => ({
        cardId,
        listed,
        toAdd: pending.get(cardId) || 0,
        stock: cards.find((c) => c.id === cardId)?.stock || 0,
      })),
      lastSync: setting("lastSync"),
      lastError: setting("lastError"),
      autoSince: setting("autoSince"),
      seller: setting("seller"),
    };
  }
  const mapListing = db.transaction((key: string, cardId: number) => {
    if (!holdings().some((c) => c.id === cardId))
      throw new Error("Card not found.");
    const exists = db
      .prepare("SELECT key FROM ebay_listings WHERE key=?")
      .get(key);
    const hasOrder = (
      db.prepare("SELECT payload FROM ebay_orders").all() as any[]
    ).some((row) => {
      const o = JSON.parse(row.payload);
      return listingKey(o.itemId, o.sku, o.variation) === key;
    });
    if (!exists && !hasOrder) throw new Error("Listing not found.");
    if (mapped(key) && mapped(key) !== cardId)
      throw new Error(
        "This listing is already matched. Review its history before changing the mapping.",
      );
    db.prepare(
      "INSERT INTO ebay_mappings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET card_id=excluded.card_id",
    ).run(key, cardId);
  });
  const reconcile = db.transaction(() => {
    const lastSync = setting("lastSync");
    if (
      !lastSync ||
      Date.now() - Date.parse(lastSync) > 15 * 60 * 1000 ||
      setting("lastError")
    )
      throw new Error("Sync successfully before using listed quantities.");
    let updated = 0;
    for (const row of snapshot().reconciliation) {
      if (row.toAdd <= 0) continue;
      db.prepare(
        "INSERT INTO movements(card_id,quantity,total_cost,date) VALUES (?,?,0,?)",
      ).run(row.cardId, row.toAdd, new Date().toISOString().slice(0, 10));
      db.prepare(
        "INSERT INTO ebay_baselines VALUES (?,?) ON CONFLICT(card_id) DO UPDATE SET since=excluded.since",
      ).run(row.cardId, lastSync);
      for (const listing of snapshot().listings.filter(
        (l: any) => l.active && l.cardId === row.cardId && l.available > 0,
      )) {
        db.prepare(
          "INSERT OR IGNORE INTO ebay_stock_imports VALUES (?,?,?)",
        ).run(listing.key, listing.available, lastSync);
      }
      updated++;
    }
    return updated;
  });
  const reviewOrder = db.transaction(
    (key: string, mode: string, fees: number) => {
      const record = db
        .prepare("SELECT * FROM ebay_orders WHERE key=?")
        .get(key) as any;
      if (!record) throw new Error("Order not found.");
      if (mode === "already-counted") {
        if (record.sale_id)
          throw new Error("This order already has a recorded sale.");
        db.prepare(
          "UPDATE ebay_orders SET disposition='already-counted',issue='' WHERE key=?",
        ).run(key);
      } else if (mode === "fees") {
        if (!record.sale_id)
          throw new Error("Apply the sale before setting fees.");
        const gross = (
          db
            .prepare("SELECT gross FROM sales WHERE id=?")
            .get(record.sale_id) as any
        ).gross;
        if (money(fees) > gross)
          throw new Error("Fees exceed the recorded sale amount.");
        db.prepare("UPDATE sales SET fees=? WHERE id=?").run(
          fees,
          record.sale_id,
        );
        db.prepare("UPDATE ebay_orders SET fees_confirmed=1 WHERE key=?").run(
          key,
        );
      } else if (mode === "apply") apply(key, money(fees), true);
      else throw new Error("Unknown review action.");
    },
  );
  return {
    setting,
    setSetting,
    ingest,
    snapshot,
    mapListing,
    reconcile,
    reviewOrder,
    processAccountDeletion,
  };
}
