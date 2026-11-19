import type Database from "better-sqlite3";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export const checkoutCredential = (key = process.env.STRIPE_SECRET_KEY || "") =>
  createHash("sha256").update(key).digest("hex");
export const checkoutCancelHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export function createCheckoutStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS shop_checkout_attempts (
    order_id TEXT PRIMARY KEY REFERENCES shop_orders(id), request TEXT,
    credential TEXT NOT NULL DEFAULT '', cancel_hash TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    next_check INTEGER NOT NULL DEFAULT 0, lease_until INTEGER,
    lease_token TEXT, last_error TEXT NOT NULL DEFAULT ''
  );`);

  // Reservation and immutable Stripe request commit together, before any network IO.
  function prepare<T extends { id: string }>(reserve: () => T, requestFor: (order: T) => any, cancelToken: string) {
    return db.transaction(() => {
      const order = reserve();
      const request = requestFor(order);
      const token = randomUUID();
      db.prepare(`INSERT INTO shop_checkout_attempts
        (order_id,request,credential,cancel_hash,created_at,lease_until,lease_token)
        VALUES (?,?,?,?,?,?,?)`).run(order.id, JSON.stringify(request), checkoutCredential(),
          checkoutCancelHash(cancelToken), Date.now(), Date.now() + 5 * 60_000, token);
      return { order, request, token };
    })();
  }

  const claim = db.transaction((id?: string, now = Date.now()) => {
    const order = db.prepare(`SELECT o.* FROM shop_orders o
      LEFT JOIN shop_checkout_attempts a ON a.order_id=o.id
      WHERE o.status='pending' AND (? IS NULL OR o.id=?)
      AND (? IS NOT NULL OR COALESCE(a.next_check,0)<=?)
      AND COALESCE(a.lease_until,0)<=?
      ORDER BY COALESCE(a.next_check,0),o.created LIMIT 1`).get(id || null, id || null, id || null, now, now) as any;
    if (!order) return null;
    // Older pending orders with linked sessions can also be checked. Legacy
    // unlinked orders have no replayable request and require manual review.
    db.prepare(`INSERT OR IGNORE INTO shop_checkout_attempts(order_id,created_at)
      VALUES (?,?)`).run(order.id, Date.parse(order.created));
    const token = randomUUID();
    db.prepare(`UPDATE shop_checkout_attempts SET lease_until=?,lease_token=? WHERE order_id=?`)
      .run(now + 5 * 60_000, token, order.id);
    const attempt = db.prepare("SELECT * FROM shop_checkout_attempts WHERE order_id=?").get(order.id) as any;
    return { order, attempt, token };
  });
  function finish(id: string, token: string, code = "", delay = 60_000) {
    db.prepare(`UPDATE shop_checkout_attempts SET lease_until=NULL,lease_token=NULL,next_check=?,last_error=?
      WHERE order_id=? AND lease_token=?`).run(Date.now() + delay,
        /^[A-Za-z0-9_]{1,80}$/.test(code) ? code : code ? "RECONCILIATION_FAILED" : "", id, token);
  }
  function requestCancel(id: string, token: unknown) {
    const attempt = db.prepare("SELECT cancel_hash FROM shop_checkout_attempts WHERE order_id=?").get(id) as any;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || !attempt?.cancel_hash ||
      !timingSafeEqual(Buffer.from(attempt.cancel_hash, "hex"), Buffer.from(checkoutCancelHash(token), "hex")))
      throw new Error("Checkout not found.");
    db.prepare("UPDATE shop_checkout_attempts SET cancel_requested=1,next_check=0 WHERE order_id=?").run(id);
  }
  const cancellationRequested = (id: string) => !!(db.prepare(
    "SELECT cancel_requested FROM shop_checkout_attempts WHERE order_id=?").get(id) as any)?.cancel_requested;
  return { prepare, claim, finish, requestCancel, cancellationRequested };
}
