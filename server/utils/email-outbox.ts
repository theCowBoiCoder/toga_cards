import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type EmailKind = "order-paid" | "order-dispatched" | "return-requested" |
  "return-updated" | "refund-completed" | "refund-failed";
export type OutboxEmail = {
  id: string;
  kind: EmailKind;
  audience: "customer" | "owner";
  recipient: string;
  payload: string;
  attempts: number;
};

export function createEmailOutbox(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS shop_email_outbox (
    id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL REFERENCES shop_orders(id), kind TEXT NOT NULL,
    audience TEXT NOT NULL, recipient TEXT NOT NULL, payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    available_at INTEGER NOT NULL, lease_until INTEGER, lease_token TEXT,
    created TEXT NOT NULL, sent_at TEXT, error_code TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS shop_email_due ON shop_email_outbox(status, available_at);`);

  // Called inside the same transaction as the order change. Snapshot the event,
  // so later edits cannot change an already queued confirmation or refund email.
  function enqueue(eventKey: string, kind: EmailKind, orderId: string, extra = {}) {
    const order = db.prepare("SELECT * FROM shop_orders WHERE id=?").get(orderId) as any;
    if (!order) throw new Error("Email order not found.");
    const items = db.prepare(`SELECT i.quantity,i.price,i.sku,c.player,c.number,c.variant
      FROM shop_order_items i JOIN cards c ON c.id=i.card_id WHERE i.order_id=?`).all(orderId);
    const payload = JSON.stringify({ order: {
      id: order.id, total: order.total, shipping: order.shipping,
      shipping_method: order.shipping_method, customer_id: order.customer_id,
      email: order.email, address: order.address,
      tracking_reference: order.tracking_reference, carrier: order.carrier,
      tracking_url: order.tracking_url, items,
    }, ...extra });
    for (const audience of ["customer", "owner"] as const) {
      // A failed refund needs staff review; it must not look like a completed refund.
      if (audience === "customer" && (kind === "refund-failed" || !order.email)) continue;
      db.prepare(`INSERT OR IGNORE INTO shop_email_outbox
        (id,event_key,order_id,kind,audience,recipient,payload,available_at,created)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), `${eventKey}:${audience}`,
          orderId, kind, audience, audience === "customer" ? order.email : "",
          payload, Date.now(), new Date().toISOString());
    }
  }

  const claim = db.transaction((now = Date.now()) => {
    const row = db.prepare(`SELECT * FROM shop_email_outbox
      WHERE (status='pending' AND available_at<=?) OR (status='sending' AND lease_until<=?)
      ORDER BY available_at,created LIMIT 1`).get(now, now) as OutboxEmail | undefined;
    if (!row) return null;
    const token = randomUUID();
    db.prepare(`UPDATE shop_email_outbox SET status='sending',attempts=attempts+1,
      lease_until=?,lease_token=? WHERE id=?`).run(now + 10 * 60_000, token, row.id);
    return { ...row, attempts: row.attempts + 1, token };
  });
  function sent(id: string, token: string) {
    db.prepare(`UPDATE shop_email_outbox SET status='sent',sent_at=?,lease_until=NULL,
      lease_token=NULL,error_code='' WHERE id=? AND status='sending' AND lease_token=?`)
      .run(new Date().toISOString(), id, token);
  }
  function failed(id: string, token: string, attempts: number, errorCode: string, now = Date.now()) {
    const delay = Math.min(3600_000, 30_000 * 2 ** Math.min(attempts - 1, 7));
    db.prepare(`UPDATE shop_email_outbox SET status=?,available_at=?,lease_until=NULL,
      lease_token=NULL,error_code=? WHERE id=? AND status='sending' AND lease_token=?`)
      .run(attempts >= 8 ? "failed" : "pending", now + delay,
        /^[A-Z0-9_]{1,40}$/.test(errorCode) ? errorCode : "DELIVERY_FAILED", id, token);
  }
  function retry(id: string) {
    const result = db.prepare(`UPDATE shop_email_outbox SET status='pending',attempts=0,
      available_at=?,error_code='' WHERE id=? AND status='failed'`).run(Date.now(), id);
    if (!result.changes) throw new Error("Only failed emails can be retried.");
  }
  const history = () => db.prepare(`SELECT id,order_id,kind,audience,status,attempts,
    created,sent_at,error_code FROM shop_email_outbox ORDER BY created DESC,rowid DESC LIMIT 200`).all();
  return { enqueue, claim, sent, failed, retry, history };
}
