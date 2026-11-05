import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
import catalogue from "../catalog/topps-premier-league-2026-27.json";

test("official catalogue is complete, zero-stock and repeat-safe", () => {
  const inv = createInventory(":memory:");
  assert.equal(catalogue.cards.length, 1138);
  assert.equal(new Set(catalogue.cards.map((c) => c.variant)).size, 43);
  assert.deepEqual(
    catalogue.cards
      .filter((c) => ["Base", "Future Stars"].includes(c.variant))
      .map((c) => Number(c.number))
      .sort((a, b) => a - b),
    Array.from({ length: 300 }, (_, i) => i + 1),
  );
  assert.equal(inv.importCatalogue(catalogue), 1138);
  assert.ok(
    inv.snapshot().cards.every((c) => c.stock === 0 && c.stock_cost === 0),
  );
  inv.mutate({
    action: "stock",
    cardId: 1,
    quantity: 3,
    unitCost: 150,
    date: "2026-09-08",
  });
  inv.mutate({
    action: "sale",
    cardId: 1,
    quantity: 1,
    unitPrice: 500,
    fees: 50,
    platform: "Test",
    date: "2026-09-08",
  });
  const before = inv.snapshot();
  assert.equal(inv.importCatalogue(catalogue), 0);
  assert.deepEqual(inv.snapshot(), before);
  const dual = catalogue.cards.find((c) => c.number === "DA-ZP");
  assert.equal(dual?.player, "Gianfranco Zola / Cole Palmer");
  assert.equal(
    catalogue.cards.find((c) => c.number === "104" && c.variant === "Base")
      ?.player,
    "Cole Palmer",
  );
  inv.close();
});

test("set stock changes holdings without rewriting sales and rejects stale edits", () => {
  const inv = createInventory(":memory:");
  inv.importCatalogue({ ...catalogue, cards: catalogue.cards.slice(0, 1) });
  const adjust = {
    action: "adjust",
    cardId: 1,
    quantity: 3,
    expectedStock: 0,
    unitCost: 101,
    date: "2026-09-08",
  };
  inv.mutate(adjust);
  inv.mutate({
    action: "sale",
    cardId: 1,
    quantity: 1,
    unitPrice: 500,
    fees: 50,
    platform: "Test",
    date: "2026-09-08",
  });
  const sales = inv.snapshot().sales;
  assert.throws(
    () => inv.mutate({ ...adjust, quantity: 5 }),
    /Stock has changed/,
  );
  inv.mutate({ ...adjust, expectedStock: 2, quantity: 1 });
  assert.equal(inv.snapshot().cards[0].stock_cost, 101);
  inv.mutate({ ...adjust, expectedStock: 1, quantity: 0 });
  assert.equal(inv.snapshot().cards[0].stock_cost, 0);
  assert.deepEqual(inv.snapshot().sales, sales);
  assert.throws(() => inv.mutate({ ...adjust, quantity: -1 }));
  inv.close();
});
