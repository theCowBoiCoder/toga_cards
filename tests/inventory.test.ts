import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
const card = {
  action: "card",
  player: "Test player",
  club: "Test club",
  season: "2025/26",
  collection: "Topps",
  number: "1",
  variant: "Base",
  condition: "Near mint",
  quantity: 3,
  unitCost: 101,
  date: "2026-09-08",
};
test("stock, sale accounting, overselling and atomic rollback", () => {
  const inv = createInventory(":memory:");
  inv.mutate(card);
  const sale = {
    action: "sale",
    cardId: 1,
    quantity: 2,
    unitPrice: 400,
    fees: 50,
    date: "2026-09-08",
    platform: "eBay",
  };
  let state = inv.mutate(sale);
  assert.equal(state.cards[0].stock, 1);
  assert.equal(state.cards[0].stock_cost, 101);
  assert.equal((state.sales[0] as any).cost, 202);
  assert.throws(() => inv.mutate(sale), /not enough stock/);
  assert.throws(() => inv.mutate({ ...card, quantity: -1 }));
  assert.equal(inv.snapshot().cards.length, 1);
  inv.mutate({
    action: "stock",
    cardId: 1,
    quantity: 1,
    unitCost: 201,
    date: "2026-09-08",
  });
  state = inv.mutate({ ...sale, quantity: 2 });
  assert.equal(state.cards[0].stock, 0);
  assert.equal(state.cards[0].stock_cost, 0);
  inv.close();
});
test("rejects invalid dates and fractional money", () => {
  const inv = createInventory(":memory:");
  assert.throws(() => inv.mutate({ ...card, date: "2026-02-30" }));
  assert.throws(() => inv.mutate({ ...card, unitCost: 1.5 }));
  assert.equal(inv.snapshot().cards.length, 0);
  inv.close();
});
