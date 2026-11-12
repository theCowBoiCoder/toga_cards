import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
import { listingKey } from "../server/utils/ebay-store";
import { runStockSyncCycle, type LiveListing } from "../server/utils/stock-sync-worker";

const initial = { key: listingKey("123", "CARD"), itemId: "123", sku: "CARD", title: "One card", variation: "", available: 4, sold: 0 };
function setup(sameCard = false) {
  const inv = createInventory(":memory:");
  for (const player of ["First", "Second"]) inv.mutate({ action: "card", player, club: "Chelsea", season: "2026/27", collection: "Topps", number: player, variant: "Base", condition: "Near mint", quantity: 4, unitCost: 50, date: "2026-11-12" });
  const other = { ...initial, key: listingKey("456", "OTHER"), itemId: "456", sku: "OTHER" };
  inv.ebay.ingest([initial, other], [], new Date().toISOString());
  inv.ebay.mapListing(initial.key, 1);
  inv.ebay.mapListing(other.key, sameCard ? 1 : 2);
  inv.ebay.setSetting("stockSyncEnabled", "true");
  inv.ebay.setSetting("autoSince", "2020-01-01");
  inv.shop.publish({ cardId: 1, quantity: 2, price: 50, stockConfirmed: true });
  inv.shop.publish({ cardId: 2, quantity: 3, price: 50, stockConfirmed: true });
  const live: Record<string, LiveListing> = Object.fromEntries([initial, other].map(l => [l.itemId, { available: 4, sold: 0, active: true, fixedPrice: true, variation: false, sku: l.sku, tracking: "ItemID" }]));
  const writes: { id: string; quantity: number }[] = [];
  let imports = 0;
  const dependencies = {
    inventory: inv,
    syncOrders: async () => { imports++; inv.ebay.ingest([initial, other].map(l => ({ ...l, available: live[l.itemId].available, sold: live[l.itemId].sold })), [], new Date().toISOString()); },
    readListing: async (id: string) => ({ ...live[id] }),
    updateListing: async (id: string, quantity: number) => { writes.push({ id, quantity }); live[id].available = quantity; },
  };
  return { inv, live, writes, dependencies, imports: () => imports };
}

test("legacy automatic flags and queued jobs cannot update eBay without a selection", async () => {
  const f = setup();
  try {
    f.inv.stockSync.enqueueAll();
    await runStockSyncCycle(f.dependencies);
    assert.equal(f.imports(), 0);
    assert.deepEqual(f.writes, []);
    assert.equal(f.inv.shop.products().find(c => c.id === 1)?.available, 2);
  } finally { f.inv.close(); }
});

test("only the selected card is pushed from website stock, preserving its price", async () => {
  const f = setup();
  try {
    await runStockSyncCycle(f.dependencies, [1]);
    assert.deepEqual(f.writes, [{ id: "123", quantity: 2 }]);
    assert.equal(f.live["456"].available, 4);
    assert.equal(f.inv.shop.products().find(c => c.id === 1)?.available, 2);
    assert.equal(f.inv.shop.products().find(c => c.id === 1)?.price, 50);
    assert.equal(f.inv.stockSync.jobs()[0].status, "verified");
    f.inv.shop.publish({ cardId: 1, quantity: 3, price: 50, stockConfirmed: true });
    await runStockSyncCycle(f.dependencies);
    assert.equal(f.live["123"].available, 2);
    await runStockSyncCycle(f.dependencies, [1]);
    assert.equal(f.live["123"].available, 3);
  } finally { f.inv.close(); }
});

test("checkout holds reduce the selected eBay target and expiry does not trigger a write", async () => {
  const f = setup();
  try {
    const order = f.inv.shop.reserve([{ id: 1, quantity: 1 }], 0);
    await runStockSyncCycle(f.dependencies, [1]);
    assert.equal(f.live["123"].available, 1);
    f.inv.shop.release(order.id);
    await runStockSyncCycle(f.dependencies);
    assert.equal(f.live["123"].available, 1);
    assert.equal(f.inv.shop.products().find(c => c.id === 1)?.available, 2);
  } finally { f.inv.close(); }
});

test("uncertain writes do not hide website stock or retry without another selection", async () => {
  const f = setup();
  try {
    const update = f.dependencies.updateListing;
    f.dependencies.updateListing = async (id, n) => { await update(id, n); throw new Error("socket timeout"); };
    await assert.rejects(runStockSyncCycle(f.dependencies, [1]), /uncertain/);
    assert.equal(f.inv.stockSync.jobs()[0].status, "review");
    assert.equal(f.inv.shop.products().find(c => c.id === 1)?.available, 2);
    f.dependencies.updateListing = update;
    await runStockSyncCycle(f.dependencies);
    assert.equal(f.writes.length, 1);
    await runStockSyncCycle(f.dependencies, [1]);
    assert.equal(f.writes.length, 1);
  } finally { f.inv.close(); }
});

test("invalid or concurrent selections cannot write marketplace quantities", async () => {
  const f = setup();
  try {
    for (const selection of [[1, 1], [0], [1.5], [999]]) await assert.rejects(runStockSyncCycle(f.dependencies, selection));
    const owner = f.inv.stockSync.acquire()!;
    await assert.rejects(runStockSyncCycle(f.dependencies, [1]), /synchronisation/);
    f.inv.stockSync.release(owner);
    assert.deepEqual(f.writes, []);
  } finally { f.inv.close(); }
});

test("unrelated unmatched listings do not block a selected mapped card", async () => {
  const f = setup();
  try {
    const sync = f.dependencies.syncOrders;
    f.dependencies.syncOrders = async () => {
      await sync();
      const rows = f.inv.ebay.snapshot().listings;
      f.inv.ebay.ingest([...rows, { ...initial, key: listingKey("999", "UNKNOWN"), itemId: "999", sku: "UNKNOWN" }], [], new Date().toISOString());
    };
    await runStockSyncCycle(f.dependencies, [1]);
    assert.deepEqual(f.writes, [{ id: "123", quantity: 2 }]);
  } finally { f.inv.close(); }
});

test("duplicate linked listings share the website quantity, with reductions before replenishment", async () => {
  const f = setup(true);
  try {
    f.inv.shop.publish({ cardId: 1, quantity: 3, price: 50, stockConfirmed: true });
    f.live["123"].available = 0;
    await runStockSyncCycle(f.dependencies, [1]);
    assert.deepEqual(f.writes, [{ id: "456", quantity: 0 }, { id: "123", quantity: 3 }]);
    assert.equal(f.live["123"].available + f.live["456"].available, 3);
  } finally { f.inv.close(); }
});

import { createEbayStockAdapter } from "../server/utils/stock-sync-ebay";
test("eBay adapter checks total minus sold and sends only stock, preserving zero-stock listings", async () => {
  const calls: { name: string; body: string }[] = [];
  let preference = false;
  const adapter = createEbayStockAdapter(async (name, body) => {
    calls.push({ name, body });
    if (name === "GetItem")
      return {
        Item: {
          ItemID: "123",
          SKU: "A&B",
          ListingDuration: "GTC",
          ListingType: "FixedPriceItem",
          Quantity: "7",
          SellingStatus: { QuantitySold: "3", ListingStatus: "Active" },
        },
      };
    if (name === "SetUserPreferences") preference = true;
    return { OutOfStockControlPreference: String(preference) };
  });
  const live = await adapter.readListing("123");
  assert.equal(live.available, 4);
  assert.equal(live.sold, 3);
  live.tracking = "SKU";
  await adapter.updateListing("123", 0, live);
  assert.equal(preference, true);
  assert.deepEqual(
    calls.map((c) => c.name),
    [
      "GetItem",
      "GetUserPreferences",
      "SetUserPreferences",
      "GetUserPreferences",
      "ReviseInventoryStatus",
    ],
  );
  assert.equal(
    calls.at(-1)?.body,
    "<InventoryStatus><SKU>A&amp;B</SKU><Quantity>0</Quantity></InventoryStatus>",
  );
  assert.ok(calls.every((c) => !c.body.includes("StartPrice")));
  await adapter.updateListing("123", 5, live);
  assert.ok(calls.at(-1)?.body.includes("<Quantity>5</Quantity>"));
});
test("failed out-of-stock verification prevents a zero-quantity write", async () => {
  let wrote = false;
  const adapter = createEbayStockAdapter(async (name) => {
    if (name === "ReviseInventoryStatus") wrote = true;
    return { OutOfStockControlPreference: "false" };
  });
  await assert.rejects(
    adapter.updateListing("123", 0, {
      available: 1,
      sold: 0,
      sku: "",
      tracking: "ItemID",
      duration: "GTC",
      fixedPrice: true,
      active: true,
      variation: false,
    }),
    /could not be verified/,
  );
  assert.equal(wrote, false);
});
