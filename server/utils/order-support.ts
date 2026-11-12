import type Database from "better-sqlite3";

export function createOrderSupport(
  db: Database.Database,
  stockChanged: (id: number) => void,
) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(shop_orders)").all() as any[]).map(
      (c) => c.name,
    ),
  );
  for (const [name, definition] of Object.entries({
    shipping_method: "TEXT NOT NULL DEFAULT ''",
    customer_id: "INTEGER",
    payment_intent: "TEXT",
    carrier: "TEXT NOT NULL DEFAULT ''",
    tracking_url: "TEXT NOT NULL DEFAULT ''",
  })) {
    if (!columns.has(name))
      db.exec(`ALTER TABLE shop_orders ADD COLUMN ${name} ${definition}`);
  }
  const itemColumns = new Set(
    (db.prepare("PRAGMA table_info(shop_order_items)").all() as any[]).map(
      (c) => c.name,
    ),
  );
  if (!itemColumns.has("sale_id"))
    db.exec("ALTER TABLE shop_order_items ADD COLUMN sale_id INTEGER");
  if (!itemColumns.has("returned"))
    db.exec(
      "ALTER TABLE shop_order_items ADD COLUMN returned INTEGER NOT NULL DEFAULT 0",
    );
  db.exec(`CREATE INDEX IF NOT EXISTS shop_customer_orders ON shop_orders(customer_id, created);
    CREATE TABLE IF NOT EXISTS shop_returns (order_id TEXT PRIMARY KEY REFERENCES shop_orders(id), reason TEXT NOT NULL, status TEXT NOT NULL, response TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shop_refunds (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES shop_orders(id), amount INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, stripe_id TEXT UNIQUE, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS shop_payment_intent ON shop_orders(payment_intent) WHERE payment_intent IS NOT NULL;`);
  const order = (id: string) =>
    db.prepare("SELECT * FROM shop_orders WHERE id=?").get(id) as any;
  const refunds = (id: string) =>
    db
      .prepare("SELECT * FROM shop_refunds WHERE order_id=? ORDER BY created")
      .all(id) as any[];
  const returnRequest = (id: string) =>
    db.prepare("SELECT * FROM shop_returns WHERE order_id=?").get(id) as any;
  const refundSummary = (id: string) => {
    const rows = refunds(id);
    return {
      refunded: rows
        .filter((r) => r.status === "succeeded")
        .reduce((n, r) => n + r.amount, 0),
      refundHeld: rows
        .filter((r) => !["succeeded", "failed", "canceled"].includes(r.status))
        .reduce((n, r) => n + r.amount, 0),
    };
  };
  function details(id: string) {
    const current = order(id);
    if (!current) throw new Error("Order not found.");
    return {
      ...current,
      ...refundSummary(id),
      refunds: refunds(id),
      returnRequest: returnRequest(id) || null,
      items: db
        .prepare(
          "SELECT i.*,c.player,c.number,c.variant,c.collection,c.season FROM shop_order_items i JOIN cards c ON c.id=i.card_id WHERE order_id=?",
        )
        .all(id),
    };
  }
  function customerOrder(customerId: number, id: string) {
    const current = details(id);
    if (current.customer_id !== customerId) throw new Error("Order not found.");
    const { session_id, payment_intent, customer_id, ...visible } = current;
    return {
      ...visible,
      refunds: current.refunds.map(({ amount, status, created }: any) => ({
        amount,
        status,
        created,
      })),
      items: current.items.map(({ sale_id, ...item }: any) => item),
    };
  }
  function customerOrders(customerId: number) {
    return (
      db
        .prepare(
          "SELECT id FROM shop_orders WHERE customer_id=? ORDER BY created DESC",
        )
        .all(customerId) as any[]
    ).map((r) => customerOrder(customerId, r.id));
  }
  const openReturn = db.transaction((id: string, reason: unknown) => {
    const current = order(id);
    const text = typeof reason === "string" ? reason.trim() : "";
    if (!current || current.status !== "paid" || !text || text.length > 2000)
      throw new Error(
        "Choose a paid order and enter a reason (up to 2,000 characters).",
      );
    if (returnRequest(id))
      throw new Error(
        "A return or refund request already exists for this order.",
      );
    const now = new Date().toISOString();
    db.prepare("INSERT INTO shop_returns VALUES (?,?,'requested','',?,?)").run(
      id,
      text,
      now,
      now,
    );
  });
  function requestReturn(customerId: number, id: string, reason: unknown) {
    customerOrder(customerId, id);
    openReturn(id, reason);
  }
  const reviewReturn = db.transaction(
    (id: string, status: unknown, response: unknown) => {
      const current = returnRequest(id);
      const allowed: Record<string, string[]> = {
        requested: ["approved", "declined"],
        approved: ["received", "closed"],
        received: ["closed"],
        declined: ["approved"],
        closed: [],
      };
      const text = typeof response === "string" ? response.trim() : "";
      if (
        !current ||
        typeof status !== "string" ||
        !allowed[current.status]?.includes(status) ||
        !text ||
        text.length > 2000
      )
        throw new Error(
          "Choose a valid return status and enter a customer response.",
        );
      db.prepare(
        "UPDATE shop_returns SET status=?,response=?,updated=? WHERE order_id=?",
      ).run(status, text, new Date().toISOString(), id);
    },
  );
  const restockReturn = db.transaction(
    (id: string, cardId: number, quantity: number) => {
      const request = returnRequest(id);
      const item = db
        .prepare(
          "SELECT i.*,s.cost FROM shop_order_items i LEFT JOIN sales s ON s.id=i.sale_id WHERE order_id=? AND i.card_id=?",
        )
        .get(id, cardId) as any;
      if (
        !request ||
        !["received", "closed"].includes(request.status) ||
        !item ||
        !Number.isSafeInteger(quantity) ||
        quantity < item.returned ||
        quantity < 1 ||
        quantity > item.quantity ||
        item.cost == null
      )
        throw new Error(
          "Confirm the return was received and enter the total returned quantity, within the number bought.",
        );
      if (quantity === item.returned) return;
      const difference = quantity - item.returned;
      const cost =
        Math.round((item.cost * quantity) / item.quantity) -
        Math.round((item.cost * item.returned) / item.quantity);
      db.prepare(
        "INSERT INTO movements(card_id,quantity,total_cost,date) VALUES (?,?,?,?)",
      ).run(cardId, difference, cost, new Date().toISOString().slice(0, 10));
      db.prepare(
        "UPDATE shop_order_items SET returned=? WHERE order_id=? AND card_id=?",
      ).run(quantity, id, cardId);
      stockChanged(cardId);
    },
  );
  const refundRequest = (id: string) =>
    db.prepare("SELECT * FROM shop_refunds WHERE id=?").get(id) as any;
  const prepareRefund = db.transaction(
    (id: string, amount: number, reason: unknown, requestId: string) => {
      const current = order(id);
      const text = typeof reason === "string" ? reason.trim() : "";
      if (
        !current ||
        current.status !== "paid" ||
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        !text ||
        text.length > 500
      )
        throw new Error(
          "Choose a paid order, positive refund amount and a reason.",
        );
      if (!/^[0-9a-f-]{36}$/i.test(requestId))
        throw new Error("Invalid refund request identity.");
      const existing = refundRequest(requestId);
      if (existing) {
        if (
          existing.order_id !== id ||
          existing.amount !== amount ||
          existing.reason !== text
        )
          throw new Error("Refund request details do not match.");
        if (
          !existing.stripe_id &&
          Date.now() - Date.parse(existing.created) > 23 * 60 * 60 * 1000
        )
          throw new Error(
            "The refund retry window expired. Inspect Stripe before making another request.",
          );
        return existing;
      }
      if (
        refunds(id).some(
          (r) => !["succeeded", "failed", "canceled"].includes(r.status),
        )
      )
        throw new Error(
          "An existing refund needs reconciliation before another can be issued.",
        );
      if (amount > current.total - refundSummary(id).refunded)
        throw new Error("Refund exceeds the remaining order total.");
      const key = requestId,
        now = new Date().toISOString();
      db.prepare(
        "INSERT INTO shop_refunds VALUES (?,?,?,?,'requested',NULL,?,?)",
      ).run(key, id, amount, text, now, now);
      return db
        .prepare("SELECT * FROM shop_refunds WHERE id=?")
        .get(key) as any;
    },
  );
  function failRefundRequest(id: string) {
    db.prepare(
      "UPDATE shop_refunds SET status='failed',updated=? WHERE id=? AND status='requested' AND stripe_id IS NULL",
    ).run(new Date().toISOString(), id);
  }
  function bindPayment(id: string, paymentIntent: string) {
    const current = order(id);
    if (
      !current ||
      !paymentIntent.startsWith("pi_") ||
      (current.payment_intent && current.payment_intent !== paymentIntent)
    )
      throw new Error("Payment identity does not match order.");
    db.prepare("UPDATE shop_orders SET payment_intent=? WHERE id=?").run(
      paymentIntent,
      id,
    );
  }
  const recordRefund = db.transaction((refund: any) => {
    const pi =
      typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : refund.payment_intent?.id;
    const current = db
      .prepare("SELECT * FROM shop_orders WHERE payment_intent=?")
      .get(pi || "") as any;
    if (!current) return false;
    if (
      refund.currency !== "gbp" ||
      !Number.isSafeInteger(refund.amount) ||
      refund.amount < 1 ||
      refund.amount > current.total ||
      ![
        "pending",
        "requires_action",
        "succeeded",
        "failed",
        "canceled",
      ].includes(refund.status)
    )
      throw new Error("Refund does not match payment.");
    const local = db
      .prepare("SELECT * FROM shop_refunds WHERE stripe_id=? OR id=?")
      .get(refund.id, refund.metadata?.refundId || "") as any;
    if (
      local &&
      (local.order_id !== current.id ||
        local.amount !== refund.amount ||
        (local.stripe_id && local.stripe_id !== refund.id))
    )
      throw new Error("Refund identity does not match request.");
    const now = new Date().toISOString();
    if (local)
      db.prepare(
        "UPDATE shop_refunds SET stripe_id=?,status=?,updated=? WHERE id=?",
      ).run(refund.id, refund.status, now, local.id);
    else
      db.prepare("INSERT INTO shop_refunds VALUES (?,?,?,?,?,?,?,?)").run(
        refund.id,
        current.id,
        refund.amount,
        "Refund recorded from Stripe",
        refund.status,
        refund.id,
        now,
        now,
      );
    return true;
  });
  return {
    details,
    customerOrder,
    customerOrders,
    requestReturn,
    openReturn,
    reviewReturn,
    restockReturn,
    refunds,
    refundSummary,
    prepareRefund,
    refundRequest,
    failRefundRequest,
    bindPayment,
    recordRefund,
  };
}
