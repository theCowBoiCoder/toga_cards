import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { listingKey, type EbayListing } from "./ebay-store";

export function createEbayPublishingStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS ebay_listing_drafts (
    id TEXT PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id), sku TEXT NOT NULL,
    seller TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'preview',
    item_id TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, issue TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ebay_listing_pending ON ebay_listing_drafts(card_id)
    WHERE status IN ('publishing','unknown');`);
  const get = (id: string) => db.prepare("SELECT * FROM ebay_listing_drafts WHERE id=?").get(id) as any;
  const lastPublished = (cardId: number) => db.prepare("SELECT * FROM ebay_listing_drafts WHERE card_id=? AND status='published' ORDER BY updated DESC LIMIT 1").get(cardId) as any;
  function assertNoUncertain(cardId: number) {
    if (db.prepare("SELECT id FROM ebay_listing_drafts WHERE card_id=? AND status IN ('publishing','unknown')").get(cardId))
      throw new Error("An earlier publication needs checking. Open its preview and use Check publication before creating another draft.");
  }
  function save(cardId: number, sku: string, seller: string, payload: unknown) {
    return db.transaction(() => {
      assertNoUncertain(cardId);
      const id = randomBytes(16).toString("hex").toUpperCase();
      db.prepare(`INSERT INTO ebay_listing_drafts(id,card_id,sku,seller,payload,created,updated)
        VALUES (?,?,?,?,?,?,?)`).run(id, cardId, sku, seller, JSON.stringify(payload), Date.now(), Date.now());
      return get(id);
    })();
  }
  const claim = db.transaction((id: string) => {
    const draft = get(id);
    if (!draft || draft.status !== "preview" || Date.now() - draft.created > 15 * 60_000)
      throw new Error("Create a fresh preview before publishing. Pending or uncertain publications must be checked first.");
    assertNoUncertain(draft.card_id);
    db.prepare("UPDATE ebay_listing_drafts SET status='publishing',updated=? WHERE id=?").run(Date.now(), id);
    return draft;
  });
  function reset(id: string) {
    db.prepare("UPDATE ebay_listing_drafts SET status='preview',updated=? WHERE id=? AND status='publishing'").run(Date.now(), id);
  }
  function unknown(id: string, itemId?: string, issue = "Check publication before retrying.") {
    db.prepare(`UPDATE ebay_listing_drafts SET status='unknown',item_id=COALESCE(?,item_id),
      updated=?,issue=? WHERE id=? AND status!='published'`)
      .run(itemId || null, Date.now(), issue.slice(0, 1400), id);
  }
  const published = db.transaction((id: string, item: EbayListing) => {
    const draft = get(id);
    if (!draft || item.sku !== draft.sku || item.variation) throw new Error("Published listing identity does not match the draft.");
    const mapped = db.prepare("SELECT card_id FROM ebay_mappings WHERE key=?").get(item.key) as any;
    if (mapped && mapped.card_id !== draft.card_id) throw new Error("This eBay listing is matched to another card.");
    db.prepare("INSERT INTO ebay_listings(key,payload,active) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,active=1")
      .run(item.key, JSON.stringify(item));
    db.prepare("INSERT INTO ebay_mappings(key,card_id) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET card_id=excluded.card_id")
      .run(listingKey(item.itemId, item.sku), draft.card_id);
    // These copies already exist in inventory. Importing the new listing must
    // never add its quantity as another physical stock receipt.
    db.prepare("INSERT OR IGNORE INTO ebay_stock_imports(listing_key,quantity,imported_at) VALUES (?,0,?)")
      .run(item.key, new Date().toISOString());
    db.prepare("INSERT OR IGNORE INTO ebay_baselines(card_id,since) VALUES (?,?)")
      .run(draft.card_id, new Date(draft.created).toISOString());
    db.prepare("INSERT OR IGNORE INTO stock_listing_watermarks(key,sold,accounted) VALUES (?,0,0)").run(item.key);
    db.prepare("UPDATE ebay_listing_drafts SET status='published',item_id=?,updated=?,issue='' WHERE id=?")
      .run(item.itemId, Date.now(), id);
    return get(id);
  });
  const latest = () => db.prepare("SELECT id,card_id,sku,status,item_id,created,issue FROM ebay_listing_drafts ORDER BY created DESC LIMIT 100").all();
  return { get, save, claim, reset, unknown, published, latest, lastPublished, assertNoUncertain };
}
