import type Database from "better-sqlite3";
import { createShippingStore } from "./shipping-store";
import { randomUUID } from "node:crypto";
import { createOrderSupport } from "./order-support";

export function createShopStore(
  db: Database.Database,
  cards: () => any[],
  sell: (body: any) => unknown,
  sync?: {
    assertIdle: () => void;
    request: (id: number, quantity: number) => void;
    sold: (id: number, quantity: number) => void;
  },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS shop_listings (card_id INTEGER PRIMARY KEY REFERENCES cards(id), price INTEGER NOT NULL, quantity INTEGER NOT NULL, photo TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS shop_orders (id TEXT PRIMARY KEY, status TEXT NOT NULL, session_id TEXT UNIQUE, total INTEGER NOT NULL, shipping INTEGER NOT NULL, created TEXT NOT NULL, email TEXT, address TEXT);
    CREATE TABLE IF NOT EXISTS shop_order_items (order_id TEXT NOT NULL REFERENCES shop_orders(id), card_id INTEGER NOT NULL REFERENCES cards(id), quantity INTEGER NOT NULL, price INTEGER NOT NULL, PRIMARY KEY(order_id,card_id));`);
  const orderColumns = new Set(
    (
      db.prepare("PRAGMA table_info(shop_orders)").all() as { name: string }[]
    ).map((column) => column.name),
  );
  if (!orderColumns.has("dispatched_at"))
    db.exec("ALTER TABLE shop_orders ADD COLUMN dispatched_at TEXT");
  if (!orderColumns.has("tracking_reference"))
    db.exec(
      "ALTER TABLE shop_orders ADD COLUMN tracking_reference TEXT NOT NULL DEFAULT ''",
    );
  const shipping = createShippingStore(db);
  const legacyShipping = process.env.SHOP_SHIPPING_PENCE;
  if (
    !shipping.all().length &&
    legacyShipping?.trim() &&
    Number.isSafeInteger(Number(legacyShipping)) &&
    Number(legacyShipping) >= 0
  ) {
    shipping.save({
      id: "legacy-standard",
      name: "Standard UK delivery",
      price: Number(legacyShipping),
      enabled: true,
    });
  }
  const support = createOrderSupport(db, (id) => {
    sync?.assertIdle();
  });
  const int = (n: unknown, min = 0) => {
    if (!Number.isSafeInteger(n) || Number(n) < min || Number(n) > 1000000)
      throw new Error("Invalid quantity or price.");
    return Number(n);
  };
  const committed = (id: number) =>
    (
      db
        .prepare("SELECT quantity FROM shop_listings WHERE card_id=?")
        .get(id) as any
    )?.quantity || 0;
  const held = (id: number) =>
    (
      db
        .prepare(
          "SELECT COALESCE(SUM(i.quantity),0) n FROM shop_order_items i JOIN shop_orders o ON o.id=i.order_id WHERE i.card_id=? AND o.status='pending'",
        )
        .get(id) as any
    ).n;
  function products() {
    const listings = db.prepare("SELECT * FROM shop_listings").all() as any[];
    return cards().map((c) => {
      const l = listings.find((l) => l.card_id === c.id);
      return {
        id: c.id,
        player: c.player,
        club: c.club,
        number: c.number,
        variant: c.variant,
        season: c.season,
        collection: c.collection,
        condition: c.condition,
        price: l?.price || null,
        photo: l?.photo || "",
        available: l
          ? Math.max(0, Math.min(l.quantity, c.stock) - held(c.id))
          : 0,
      };
    });
  }
  const publish = db.transaction((body: any) => {
    sync?.assertIdle();
    const id = int(body.cardId, 1),
      quantity = int(body.quantity),
      price = int(body.price, 50);
    const card = cards().find((c) => c.id === id);
    if (!card || quantity > card.stock || quantity < held(id))
      throw new Error("Allocation must fit physical stock and pending orders.");
    const condition = body.condition || card.condition;
    if (
      ![
        "Not assessed",
        "Near mint",
        "Excellent",
        "Very good",
        "Good",
        "Poor",
      ].includes(condition)
    )
      throw new Error("Choose a valid condition.");
    if (quantity > 0 && (condition === "Not assessed" || !body.stockConfirmed))
      throw new Error("Assess condition and confirm website stock first.");
    const photo = String(body.photo || "");
    if (
      photo &&
      ((!/^https:\/\//.test(photo) &&
        !/^\/storage\/cards\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(
          photo,
        )) ||
        photo.length > 2000)
    )
      throw new Error("Photo must be an HTTPS URL or an uploaded card image.");
    db.prepare("UPDATE cards SET condition=? WHERE id=?").run(condition, id);
    db.prepare(
      "INSERT INTO shop_listings VALUES (?,?,?,?) ON CONFLICT(card_id) DO UPDATE SET price=excluded.price,quantity=excluded.quantity,photo=excluded.photo",
    ).run(id, price, quantity, photo);
    sync?.request(id, quantity);
  });
  const reserve = db.transaction(
    (
      items: any,
      shipping: number,
      customerId?: number,
      shippingMethod = "",
    ) => {
      sync?.assertIdle();
      if (!Array.isArray(items) || !items.length || items.length > 50)
        throw new Error("Choose between 1 and 50 different cards.");
      const unique = new Set<number>(),
        available = products();
      const lines = items.map((item) => {
        const id = int(item.id, 1),
          quantity = int(item.quantity, 1);
        if (unique.has(id)) throw new Error("Duplicate basket item.");
        unique.add(id);
        const product = available.find((c) => c.id === id);
        if (!product?.price || quantity > product.available)
          throw new Error("A card is no longer available in that quantity.");
        return { ...product, quantity };
      });
      const id = randomUUID(),
        total = lines.reduce((n, l) => n + l.price * l.quantity, int(shipping));
      db.prepare(
        "INSERT INTO shop_orders(id,status,total,shipping,created) VALUES (?,'pending',?,?,?)",
      ).run(id, total, shipping, new Date().toISOString());
      db.prepare("UPDATE shop_orders SET shipping_method=? WHERE id=?").run(
        shippingMethod,
        id,
      );
      if (customerId !== undefined) {
        if (!Number.isSafeInteger(customerId) || customerId < 1)
          throw new Error("Invalid customer.");
        db.prepare("UPDATE shop_orders SET customer_id=? WHERE id=?").run(
          customerId,
          id,
        );
      }
      for (const l of lines)
        db.prepare(
          "INSERT INTO shop_order_items(order_id,card_id,quantity,price) VALUES (?,?,?,?)",
        ).run(id, l.id, l.quantity, l.price);
      return { id, total, lines };
    },
  );
  const attach = (id: string, session: string) =>
    db
      .prepare(
        "UPDATE shop_orders SET session_id=? WHERE id=? AND status='pending'",
      )
      .run(session, id);
  const release = (id: string) =>
    db
      .prepare(
        "UPDATE shop_orders SET status='expired' WHERE id=? AND status='pending'",
      )
      .run(id);
  const complete = db.transaction((session: any) => {
    sync?.assertIdle();
    const order = db
      .prepare("SELECT * FROM shop_orders WHERE session_id=?")
      .get(session.id) as any;
    if (!order) throw new Error("Order not found.");
    if (order.status === "paid") return;
    if (
      order.status !== "pending" ||
      session.payment_status !== "paid" ||
      session.currency !== "gbp" ||
      session.amount_total !== order.total
    )
      throw new Error("Payment does not match order.");
    const lines = db
      .prepare("SELECT * FROM shop_order_items WHERE order_id=?")
      .all(order.id) as any[];
    for (const l of lines) {
      if (committed(l.card_id) < l.quantity)
        throw new Error("Allocation needs review.");
      sell({
        action: "sale",
        cardId: l.card_id,
        quantity: l.quantity,
        unitPrice: l.price,
        fees: 0,
        date: new Date().toISOString().slice(0, 10),
        platform: "Website",
      });
      const sale = db
        .prepare(
          "SELECT id FROM sales WHERE card_id=? ORDER BY id DESC LIMIT 1",
        )
        .get(l.card_id) as any;
      db.prepare(
        "UPDATE shop_order_items SET sale_id=? WHERE order_id=? AND card_id=?",
      ).run(sale.id, order.id, l.card_id);
      db.prepare(
        "UPDATE shop_listings SET quantity=quantity-? WHERE card_id=?",
      ).run(l.quantity, l.card_id);
      sync?.sold(l.card_id, l.quantity);
    }
    db.prepare(
      "UPDATE shop_orders SET status='paid',email=?,address=? WHERE id=?",
    ).run(
      session.customer_details?.email || "",
      JSON.stringify(
        session.collected_information?.shipping_details ||
          session.shipping_details ||
          {},
      ),
      order.id,
    );
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (paymentIntent) support.bindPayment(order.id, paymentIntent);
  });
  const expire = (session: string) =>
    db
      .prepare(
        "UPDATE shop_orders SET status='expired' WHERE session_id=? AND status='pending'",
      )
      .run(session);
  const listings = () => db.prepare("SELECT * FROM shop_listings").all();
  const order = (id: string) =>
    db.prepare("SELECT * FROM shop_orders WHERE id=?").get(id) as any;
  const orders = () =>
    (
      db
        .prepare("SELECT * FROM shop_orders ORDER BY created DESC LIMIT 100")
        .all() as any[]
    ).map((order) => ({
      ...order,
      ...support.refundSummary(order.id),
      refunds: support.refunds(order.id),
      returnRequest: support.details(order.id).returnRequest,
      items: db
        .prepare(
          "SELECT i.card_id,i.quantity,i.price,i.returned,c.player,c.number,c.variant FROM shop_order_items i JOIN cards c ON c.id=i.card_id WHERE i.order_id=?",
        )
        .all(order.id),
    }));
  const dispatch = db.transaction(
    (
      id: string,
      tracking: unknown,
      carrier: unknown = "",
      trackingUrl: unknown = "",
    ) => {
      const current = order(id);
      if (
        !current ||
        current.status !== "paid" ||
        support.refundSummary(id).refunded >= current.total
      )
        throw new Error("Only a paid order can be marked dispatched.");
      const reference = typeof tracking === "string" ? tracking.trim() : "";
      if (!reference || reference.length > 150)
        throw new Error(
          "Enter a tracking or postage reference (maximum 150 characters).",
        );
      const carrierName = typeof carrier === "string" ? carrier.trim() : "";
      const url = typeof trackingUrl === "string" ? trackingUrl.trim() : "";
      let validTrackingUrl = true;
      if (url) {
        try {
          const parsed = new URL(url);
          validTrackingUrl =
            parsed.protocol === "https:" &&
            !!parsed.hostname &&
            !parsed.username &&
            !parsed.password;
        } catch {
          validTrackingUrl = false;
        }
      }
      if (carrierName.length > 100 || url.length > 2000 || !validTrackingUrl)
        throw new Error("Use a carrier name and an HTTPS tracking URL.");
      if (!current.dispatched_at)
        db.prepare(
          "UPDATE shop_orders SET dispatched_at=?,tracking_reference=?,carrier=?,tracking_url=? WHERE id=?",
        ).run(new Date().toISOString(), reference, carrierName, url, id);
    },
  );
  return {
    ...support,
    shipping,
    committed,
    products,
    publish,
    reserve,
    attach,
    release,
    complete,
    expire,
    orders,
    dispatch,
    listings,
    order,
  };
}
