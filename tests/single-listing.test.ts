import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createInventory } from "../server/utils/inventory";

function setup(path = ":memory:") {
  const inv = createInventory(path);
  inv.mutate({ action: "card", player: "Test Single", club: "Arsenal", number: "24",
    variant: "Base", condition: "Near mint", season: "2026/27", collection: "Topps",
    quantity: 4, unitCost: 50, date: "2026-11-19" });
  return inv;
}
const listing = { cardId: 1, quantity: 2, price: 199, photo: "https://images.example/card.jpg", stockConfirmed: true };

test("listing a single creates one website product with a stable unique SKU and a price per copy", () => {
  const inv = setup();
  try {
    assert.deepEqual(inv.shop.ensureSingle(listing), { created: true, sku: "TC-S-000001" });
    const product = inv.shop.products()[0];
    assert.equal(product.sku, "TC-S-000001");
    assert.equal(product.price, 199);
    assert.equal(product.available, 2);
    assert.equal(inv.snapshot().cards[0].stock, 4, "listing must not invent or duplicate physical stock");
    const order = inv.shop.reserve([{ id: 1, quantity: 2 }], 0);
    assert.equal(order.total, 398, "two copies are two singles, not a bundle price");
    assert.equal(order.lines[0].sku, product.sku);
    assert.equal(inv.shop.orders()[0].items[0].sku, product.sku);
  } finally { inv.close(); }
});

test("repeated or stale create requests reuse a listing without changing price, photo, stock or SKU", () => {
  const inv = setup();
  try {
    inv.shop.ensureSingle(listing);
    inv.shop.reserve([{ id: 1, quantity: 1 }], 0);
    const before = inv.shop.products()[0];
    assert.deepEqual(inv.shop.ensureSingle({ ...listing, quantity: 4, price: 999, photo: "https://images.example/other.jpg" }),
      { created: false, sku: "TC-S-000001" });
    assert.deepEqual(inv.shop.products()[0], before);
    assert.equal(inv.shop.listings().length, 1);
    inv.shop.publish({ ...listing, quantity: 3, price: 249 });
    assert.equal(inv.shop.products()[0].sku, before.sku, "explicit edits retain the SKU");
  } finally { inv.close(); }
});

test("unassessed, unconfirmed, zero-copy and overselling listings are rejected atomically", () => {
  const inv = setup();
  try {
    for (const changes of [{ stockConfirmed: false }, { quantity: 0 }, { quantity: 5 }, { condition: "Not assessed" }]) {
      assert.throws(() => inv.shop.ensureSingle({ ...listing, ...changes }));
      assert.equal(inv.shop.listings().length, 0);
    }
  } finally { inv.close(); }
});

test("different inventory cards get distinct SKUs, including different variants", () => {
  const inv = setup();
  try {
    inv.mutate({ action: "card", player: "Test Single", club: "Arsenal", number: "24",
      variant: "Gold", condition: "Near mint", season: "2026/27", collection: "Topps",
      quantity: 1, unitCost: 50, date: "2026-11-19" });
    inv.shop.ensureSingle(listing);
    inv.shop.ensureSingle({ ...listing, cardId: 2, quantity: 1 });
    assert.equal(new Set(inv.shop.products().map((p) => p.sku)).size, 2);
  } finally { inv.close(); }
});

test("existing listings receive SKUs on upgrade without changing their details or holds", () => {
  const directory = mkdtempSync(join(tmpdir(), "toga-single-upgrade-"));
  const path = join(directory, "cards.sqlite");
  let inv = setup(path);
  try {
    inv.shop.publish(listing);
    inv.shop.reserve([{ id: 1, quantity: 1 }], 0);
    inv.close();
    const db = new Database(path);
    db.exec("DROP TABLE shop_skus; ALTER TABLE shop_order_items DROP COLUMN sku");
    db.close();
    inv = createInventory(path);
    assert.equal(inv.shop.products()[0].sku, "TC-S-000001");
    assert.equal(inv.shop.products()[0].available, 1);
    assert.equal(inv.shop.products()[0].price, 199);
    assert.equal(inv.shop.products()[0].photo, listing.photo);
    assert.equal(inv.shop.orders()[0].items[0].sku, "TC-S-000001");
    inv.close();
    inv = createInventory(path);
    assert.equal(inv.shop.products()[0].sku, "TC-S-000001");
    assert.deepEqual(inv.shop.ensureSingle(listing), { created: false, sku: "TC-S-000001" });
  } finally {
    inv.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
