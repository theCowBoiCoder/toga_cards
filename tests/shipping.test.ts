import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";

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
