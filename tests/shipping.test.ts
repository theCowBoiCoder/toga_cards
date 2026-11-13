import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
import Database from "better-sqlite3";
import { createShippingStore } from "../server/utils/shipping-store";
import { basketCardCount, combinedPostage } from "../shared/shipping";

test("Royal Mail combines duplicates and different cards into one parcel charge", () => {
  const db = new Database(":memory:");
  const shipping = createShippingStore(db);
  shipping.installRoyalMail();
  assert.equal(shipping.select("royal-mail-second", 1).price, 205);
  assert.equal(shipping.select("royal-mail-first", 1).price, 370);
  const count = basketCardCount([{ id: 1, quantity: 3 }, { id: 2, quantity: 2 }]);
  assert.equal(count, 5);
  assert.equal(shipping.select("royal-mail-second", count).price, 490);
  assert.equal(shipping.select("royal-mail-first", 100).price, 620);
  assert.throws(() => shipping.select("royal-mail-first", 101), /postage quote/);
  assert.throws(() => basketCardCount([{ id: 1, quantity: -2 }]), /quantities/);
  assert.throws(() => basketCardCount([{ id: 1, quantity: 1 }, { id: 1, quantity: 1 }]), /quantities/);
  const second = shipping.all().find(option => option.id === "royal-mail-second");
  shipping.save({ ...second, packaging: 75, bands: [{ upToCards: 2, price: 200 }, { upToCards: 20, price: 500 }], enabled: true });
  shipping.installRoyalMail();
  assert.equal(shipping.select(second.id, 2).price, 275);
  assert.equal(shipping.select(second.id, 3).price, 575);
  assert.equal(shipping.all().length, 2);
  for (const bands of [[{ upToCards: 2, price: 100 }, { upToCards: 1, price: 200 }], [{ upToCards: 0, price: 100 }], [{ upToCards: 10, price: -1 }]]) {
    assert.throws(() => shipping.save({ name: "Invalid", price: 100, bands, enabled: true }), /bands/);
  }
  assert.equal(combinedPostage({ price: 100, packaging: 25, bands: [] }, 50), 125);
  db.close();
});

test("existing delivery rows migrate without changing prices or enabling services", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE shop_shipping_options (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL, min_days INTEGER, max_days INTEGER, enabled INTEGER NOT NULL DEFAULT 1); INSERT INTO shop_shipping_options VALUES ('old','Existing',299,NULL,NULL,0)");
  const shipping = createShippingStore(db);
  shipping.installRoyalMail();
  assert.equal(shipping.all().length, 1);
  assert.equal(shipping.all()[0].price, 299);
  assert.equal(shipping.all()[0].packaging, 0);
  assert.deepEqual(shipping.all()[0].bands, []);
  assert.equal(shipping.available().length, 0);
  db.close();
});

test("delivery options support multiple services, free delivery and disabled services", () => {
  const inv = createInventory(":memory:");
  const shipping = inv.shop.shipping;
  shipping.save({
    id: "standard",
    name: "Standard",
    price: 150,
    minDays: 3,
    maxDays: 5,
    enabled: true,
  });
  shipping.save({
    id: "tracked",
    name: "Tracked",
    price: 350,
    minDays: 1,
    maxDays: 2,
    enabled: true,
  });
  shipping.save({
    id: "free",
    name: "Free delivery",
    price: 0,
    enabled: false,
  });
  assert.equal(shipping.available().length, 2);
  assert.equal(shipping.select("tracked").price, 350);
  assert.throws(() => shipping.select(undefined), /Choose/);
  assert.throws(() => shipping.select("free"), /Choose/);
  shipping.save({ id: "free", name: "Free delivery", price: 0, enabled: true });
  assert.equal(shipping.select("free").price, 0);
  for (const change of [
    { price: -1 },
    { price: 1.5 },
    { minDays: 3, maxDays: 1 },
    { minDays: 2, maxDays: null },
  ])
    assert.throws(() =>
      shipping.save({ name: "Invalid", price: 100, enabled: true, ...change }),
    );
  inv.close();
});

test("changing a delivery price does not rewrite reserved order totals or its service label", () => {
  const inv = createInventory(":memory:");
  inv.mutate({
    action: "card",
    player: "Test",
    club: "Arsenal",
    season: "2026",
    collection: "Test",
    number: "1",
    variant: "Base",
    condition: "Near mint",
    quantity: 2,
    unitCost: 50,
    date: "2026-11-12",
  });
  inv.shop.publish({
    cardId: 1,
    quantity: 2,
    price: 100,
    stockConfirmed: true,
  });
  inv.shop.shipping.save({
    id: "tracked",
    name: "Tracked delivery",
    price: 250,
    enabled: true,
  });
  const option = inv.shop.shipping.select("tracked"),
    order = inv.shop.reserve(
      [{ id: 1, quantity: 1 }],
      option.price,
      undefined,
      option.name,
    );
  inv.shop.shipping.save({
    id: "tracked",
    name: "New label",
    price: 500,
    enabled: false,
  });
  assert.equal(inv.shop.order(order.id).shipping, 250);
  assert.equal(inv.shop.order(order.id).total, 350);
  assert.equal(inv.shop.order(order.id).shipping_method, "Tracked delivery");
  inv.close();
});
