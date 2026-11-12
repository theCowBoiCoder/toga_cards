import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
import { listingKey } from "../server/utils/ebay-store";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("confirmed website stock stays available despite unmatched eBay listings and sync errors", () => {
  const inv = createInventory(":memory:");
  try {
    inv.mutate({ action: "card", player: "Cole Palmer", club: "Chelsea", number: "104",
      variant: "Base", season: "2026/27", collection: "Topps", condition: "Near mint",
      quantity: 4, unitCost: 50, date: "2026-11-12" });
    inv.ebay.ingest([{ key: listingKey("123", "UNMATCHED"), itemId: "123", sku: "UNMATCHED",
      variation: "", title: "Unmatched card", available: 4, sold: 0 }], [], new Date().toISOString());
    inv.ebay.setSetting("tokens", "test-only");
    inv.ebay.setSetting("autoSince", "2020-01-01");
    inv.ebay.setSetting("stockSyncEnabled", "true");
    inv.shop.publish({ cardId: 1, quantity: 4, price: 50, stockConfirmed: true });
    inv.ebay.setSetting("stockSyncError", "eBay unavailable");
    inv.ebay.setSetting("stockSyncLastSuccess", "2020-01-01");
    inv.ebay.setSetting("stockSyncPaused", "true");
    assert.equal(inv.shop.products()[0].available, 4);
    assert.equal(inv.shop.products()[0].price, 50);
    const order = inv.shop.reserve([{ id: 1, quantity: 1 }], 0);
    assert.equal(inv.shop.products()[0].available, 3);
    inv.shop.release(order.id);
    assert.equal(inv.shop.products()[0].available, 4);
  } finally { inv.close(); }
});

test("upgrade releases previously confirmed quantities once without changing price or physical stock", () => {
  const path = join(tmpdir(), `toga-website-${randomUUID()}.sqlite`);
  let inv = createInventory(path);
  try {
    inv.mutate({ action: "card", player: "Cole Palmer", club: "Chelsea", number: "104",
      variant: "Base", season: "2026/27", collection: "Topps", condition: "Near mint",
      quantity: 4, unitCost: 50, date: "2026-11-12" });
    inv.shop.publish({ cardId: 1, quantity: 3, price: 50, stockConfirmed: true });
    inv.close();
    const db = new Database(path);
    db.exec("DELETE FROM ebay_settings WHERE key='websiteStockAuthorityVersion'; UPDATE shop_listings SET quantity=0");
    db.close();
    inv = createInventory(path);
    assert.equal(inv.shop.products()[0].available, 3);
    assert.equal(inv.shop.products()[0].price, 50);
    assert.equal(inv.snapshot().cards[0].stock, 4);
    inv.shop.publish({ cardId: 1, quantity: 0, price: 50, stockConfirmed: true });
    inv.close();
    inv = createInventory(path);
    assert.equal(inv.shop.products()[0].available, 0);
  } finally {
    inv.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
  }
});
