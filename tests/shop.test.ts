import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
const card = {
  action: "card",
  player: "Test Player",
  club: "Arsenal",
  season: "2026/27",
  collection: "Topps",
  number: "24",
  variant: "Base",
  condition: "Near mint",
  quantity: 4,
  unitCost: 50,
  date: "2026-11-05",
};
function setup() {
  const inv = createInventory(":memory:");
  inv.mutate(card);
  inv.shop.publish({
    cardId: 1,
    quantity: 3,
    price: 199,
    stockConfirmed: true,
  });
  return inv;
}
test("public products omit purchase costs and checkout locks stock atomically", () => {
  const inv = setup();
  assert.equal("stock_cost" in inv.shop.products()[0], false);
  const first = inv.shop.reserve([{ id: 1, quantity: 2 }], 150);
  assert.equal(first.total, 548);
  assert.equal(inv.shop.products()[0].available, 1);
  assert.throws(
    () => inv.shop.reserve([{ id: 1, quantity: 2 }], 150),
    /no longer available/,
  );
  assert.equal(inv.shop.orders().length, 1);
  assert.throws(
    () =>
      inv.shop.reserve(
        [
          { id: 1, quantity: 1 },
          { id: 1, quantity: 1 },
        ],
        150,
      ),
    /Duplicate/,
  );
  inv.shop.attach(first.id, "cs_expired");
  inv.shop.expire("cs_expired");
  assert.equal(inv.shop.products()[0].available, 3);
  inv.close();
});
test("signed payment fulfilment is atomic and replay-safe; prices and totals are verified", () => {
  const inv = setup();
  const o = inv.shop.reserve([{ id: 1, quantity: 2 }], 150);
  inv.shop.attach(o.id, "cs_paid");
  const s = {
    id: "cs_paid",
    payment_status: "paid",
    currency: "gbp",
    amount_total: o.total,
  };
  assert.throws(
    () => inv.shop.complete({ ...s, amount_total: 1 }),
    /does not match/,
  );
  assert.equal(inv.snapshot().sales.length, 0);
  inv.shop.complete(s);
  inv.shop.complete(s);
  assert.equal(inv.snapshot().sales.length, 1);
  assert.equal(inv.snapshot().cards[0].stock, 2);
  assert.equal(inv.shop.products()[0].available, 1);
  assert.equal(inv.shop.committed(1), 1);
  assert.equal(inv.shop.orders()[0].status, "paid");
  inv.close();
});
test("manual sales and adjustments cannot take website allocation", () => {
  const inv = setup();
  assert.throws(
    () =>
      inv.mutate({
        action: "sale",
        cardId: 1,
        quantity: 2,
        unitPrice: 100,
        fees: 0,
        date: card.date,
        platform: "eBay",
      }),
    /allocated/,
  );
  assert.throws(
    () =>
      inv.mutate({
        action: "adjust",
        cardId: 1,
        quantity: 2,
        expectedStock: 4,
        unitCost: 0,
        date: card.date,
      }),
    /allocation/,
  );
  const o = inv.shop.reserve([{ id: 1, quantity: 2 }], 0);
  assert.throws(
    () =>
      inv.shop.publish({
        cardId: 1,
        quantity: 1,
        price: 100,
        stockConfirmed: true,
      }),
    /pending/,
  );
  inv.shop.release(o.id);
  inv.close();
});
test("unassessed cards and unconfirmed stock cannot be published", () => {
  const inv = createInventory(":memory:");
  inv.mutate({ ...card, condition: "Not assessed" });
  assert.throws(
    () =>
      inv.shop.publish({
        cardId: 1,
        quantity: 1,
        price: 100,
        stockConfirmed: true,
      }),
    /Assess/,
  );
  inv.close();
});

test("condition assessment can publish catalogue stock without creating duplicate cards", () => {
  const inv = createInventory(":memory:");
  inv.mutate({ ...card, condition: "Not assessed" });
  inv.shop.publish({
    cardId: 1,
    quantity: 2,
    price: 99,
    condition: "Excellent",
    stockConfirmed: true,
  });
  assert.equal(inv.snapshot().cards.length, 1);
  assert.equal(inv.shop.products()[0].condition, "Excellent");
  inv.close();
});
