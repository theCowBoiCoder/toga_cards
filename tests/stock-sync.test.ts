import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
import { listingKey, type EbayOrder } from "../server/utils/ebay-store";
import {
  runStockSyncCycle,
  type LiveListing,
} from "../server/utils/stock-sync-worker";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
const initial = {
  key: listingKey("123", "CARD"),
  itemId: "123",
  sku: "CARD",
  title: "One card",
  variation: "",
  available: 4,
  sold: 0,
};
function setup(path = ":memory:") {
  const inv = createInventory(path);
  inv.mutate({
    action: "card",
    player: "Test player",
    club: "Arsenal",
    season: "2026/27",
    collection: "Topps",
    number: "1",
    variant: "Base",
    condition: "Near mint",
    quantity: 4,
    unitCost: 50,
    date: "2026-11-05",
  });
  inv.ebay.ingest([initial], [], new Date().toISOString());
  inv.ebay.mapListing(initial.key, 1);
  inv.ebay.setSetting("tokens", "test-only");
  inv.ebay.setSetting("autoSince", "2020-01-01T00:00:00.000Z");
  inv.stockSync.enable();
  return inv;
}
function fake(inv: ReturnType<typeof createInventory>) {
  const live: LiveListing = {
    available: 4,
    sold: 0,
    active: true,
    fixedPrice: true,
    variation: false,
    sku: "CARD",
    tracking: "ItemID",
  };
  const writes: number[] = [];
  const orders: EbayOrder[] = [];
  const dependencies = {
    inventory: inv,
    syncOrders: async () => {
      inv.ebay.ingest(
        [{ ...initial, available: live.available, sold: live.sold }],
        orders,
        new Date().toISOString(),
      );
    },
    readListing: async () => ({ ...live }),
    reduceListing: async (_id: string, n: number) => {
      writes.push(n);
      live.available = n;
    },
  };
  return { live, writes, orders, dependencies };
}
const publish = (inv: ReturnType<typeof createInventory>, n = 2) =>
  inv.shop.publish({
    cardId: 1,
    quantity: n,
    price: 199,
    stockConfirmed: true,
  });
const sale = (): EbayOrder => ({
  key: "sale-1",
  orderId: "order-1",
  itemId: "123",
  sku: "CARD",
  variation: "",
  title: "One card",
  quantity: 1,
  gross: 199,
  currency: "GBP",
  created: new Date().toISOString(),
  paid: true,
  cancelled: false,
});
test("website stock becomes purchasable only after a verified reduction on eBay", async () => {
  const inv = setup(),
    f = fake(inv);
  publish(inv);
  assert.equal(inv.shop.committed(1), 0);
  assert.equal(inv.shop.products()[0].available, 0);
  await runStockSyncCycle(f.dependencies);
  assert.deepEqual(f.writes, [2]);
  assert.equal(inv.shop.committed(1), 2);
  assert.equal(inv.shop.products()[0].available, 2);
  assert.equal(f.live.available + inv.shop.products()[0].available, 4);
  inv.close();
});
test("website payment and eBay sale consume separate pools without resurrecting sold stock", async () => {
  const inv = setup(),
    f = fake(inv);
  publish(inv);
  await runStockSyncCycle(f.dependencies);
  const o = inv.shop.reserve([{ id: 1, quantity: 1 }], 0);
  inv.shop.attach(o.id, "cs_paid");
  inv.shop.complete({
    id: "cs_paid",
    payment_status: "paid",
    currency: "gbp",
    amount_total: 199,
  });
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.stockSync.plan(1).requested, 1);
  f.live.available--;
  f.live.sold++;
  f.orders.push(sale());
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.snapshot().cards[0].stock, 2);
  assert.equal(inv.shop.products()[0].available, 1);
  assert.equal(f.live.available, 1);
  assert.deepEqual(f.writes, [2]);
  inv.close();
});
test("unknown write outcome remains durable across restart and rechecks before retry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "toga-sync-"));
  const path = join(directory, "test.sqlite");
  let inv = setup(path);
  try {
    const f = fake(inv);
    publish(inv);
    const reduce = f.dependencies.reduceListing;
    f.dependencies.reduceListing = async (id, n) => {
      await reduce(id, n);
      throw new Error("socket timeout");
    };
    await runStockSyncCycle(f.dependencies);
    assert.equal(inv.shop.committed(1), 0);
    assert.match(inv.stockSync.jobs()[0].error, /uncertain/);
    inv.close();
    inv = createInventory(path);
    const next = fake(inv);
    next.live.available = 2;
    inv.stockSync.enqueue(1);
    await runStockSyncCycle(next.dependencies);
    assert.equal(inv.shop.products()[0].available, 2);
    assert.deepEqual(next.writes, []);
  } finally {
    inv.close();
    const target = resolve(directory);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) &&
        target.includes("toga-sync-"),
    );
    rmSync(target, { recursive: true, force: true });
  }
});
test("sale during transfer quarantines eBay and keeps website unavailable until order arrives", async () => {
  const inv = setup(),
    f = fake(inv);
  publish(inv);
  const reduce = f.dependencies.reduceListing;
  let raced = false;
  f.dependencies.reduceListing = async (id, n) => {
    await reduce(id, n);
    if (!raced) {
      raced = true;
      f.live.sold++;
    }
  };
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.shop.committed(1), 0);
  assert.equal(f.live.available, 0);
  inv.stockSync.enqueue(1);
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.shop.committed(1), 0);
  assert.match(inv.stockSync.jobs()[0].error, /not yet accounted/);
  f.orders.push(sale());
  inv.stockSync.enqueue(1);
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.shop.products()[0].available, 2);
  assert.equal(inv.snapshot().cards[0].stock, 3);
  assert.equal(f.live.available, 0);
  inv.close();
});
test("a lower eBay quantity is never automatically increased to stale local stock", async () => {
  const inv = setup(),
    f = fake(inv);
  f.live.available = 1;
  await runStockSyncCycle(f.dependencies);
  assert.equal(f.live.available, 1);
  assert.deepEqual(f.writes, []);
  inv.close();
});
test("unmapped listings and unpaid orders block transfers without guessing stock", async () => {
  const inv = setup(),
    f = fake(inv);
  publish(inv);
  const other = {
    ...initial,
    key: listingKey("456", "OTHER"),
    itemId: "456",
    sku: "OTHER",
  };
  f.dependencies.syncOrders = async () => {
    inv.ebay.ingest(
      [{ ...initial, available: f.live.available, sold: f.live.sold }, other],
      [],
      new Date().toISOString(),
    );
  };
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.shop.committed(1), 0);
  assert.match(inv.stockSync.jobs()[0].error, /unmapped/);
  f.dependencies.syncOrders = async () => {
    inv.ebay.ingest(
      [{ ...initial, available: f.live.available, sold: f.live.sold }],
      [{ ...sale(), paid: false }],
      new Date().toISOString(),
    );
  };
  inv.stockSync.enqueue(1);
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.shop.committed(1), 0);
  assert.match(inv.stockSync.jobs()[0].error, /order issues/);
  inv.close();
});
test("worker lease blocks concurrent stock mutations and duplicate workers", async () => {
  const inv = setup(),
    f = fake(inv);
  publish(inv);
  const owner = inv.stockSync.acquire()!;
  assert.throws(() => publish(inv), /synchronisation/);
  assert.throws(
    () =>
      inv.mutate({
        action: "stock",
        cardId: 1,
        quantity: 1,
        unitCost: 0,
        date: "2026-11-05",
      }),
    /synchronisation/,
  );
  await runStockSyncCycle(f.dependencies);
  assert.deepEqual(f.writes, []);
  inv.stockSync.release(owner);
  await runStockSyncCycle(f.dependencies);
  assert.equal(inv.shop.products()[0].available, 2);
  inv.close();
});
test("pause and stale sync fail closed while preserving paid-order reservations", async () => {
  const inv = setup(),
    f = fake(inv);
  publish(inv);
  await runStockSyncCycle(f.dependencies);
  const o = inv.shop.reserve([{ id: 1, quantity: 1 }], 0);
  inv.stockSync.setSetting("stockSyncLastSuccess", "2020-01-01");
  assert.equal(inv.shop.products()[0].available, 0);
  inv.stockSync.pause();
  assert.equal(inv.shop.products()[0].available, 0);
  assert.equal(inv.shop.committed(1), 2);
  inv.shop.attach(o.id, "cs_paid");
  inv.shop.complete({
    id: "cs_paid",
    payment_status: "paid",
    currency: "gbp",
    amount_total: 199,
  });
  assert.equal(inv.snapshot().cards[0].stock, 3);
  assert.equal(inv.shop.committed(1), 1);
  inv.close();
});

test("multiple listings share one stock budget rather than each receiving the full count", async () => {
  const inv = setup();
  publish(inv);
  const other = {
    ...initial,
    key: listingKey("456", "SECOND"),
    itemId: "456",
    sku: "SECOND",
  };
  inv.ebay.ingest([initial, other], [], new Date().toISOString());
  inv.ebay.mapListing(other.key, 1);
  const live: Record<string, number> = { "123": 4, "456": 4 };
  const writes: any[] = [];
  await runStockSyncCycle({
    inventory: inv,
    syncOrders: async () => {
      inv.ebay.ingest(
        [initial, other].map((l) => ({ ...l, available: live[l.itemId] })),
        [],
        new Date().toISOString(),
      );
    },
    readListing: async (id) => ({
      available: live[id],
      sold: 0,
      active: true,
      fixedPrice: true,
      variation: false,
      sku: id === "123" ? "CARD" : "SECOND",
      tracking: "ItemID",
    }),
    reduceListing: async (id, n) => {
      writes.push({ id, n });
      live[id] = n;
    },
  });
  assert.deepEqual(writes, [
    { id: "123", n: 2 },
    { id: "456", n: 0 },
  ]);
  assert.equal(inv.shop.products()[0].available, 2);
  assert.equal(
    Object.values(live).reduce((a, b) => a + b, 0),
    2,
  );
  assert.equal(inv.stockSync.jobs()[0].status, "verified");
  inv.close();
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
  await adapter.reduceListing("123", 0, live);
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
  await assert.rejects(adapter.reduceListing("123", 5, live), /only reduce/);
});
test("failed out-of-stock verification prevents a zero-quantity write", async () => {
  let wrote = false;
  const adapter = createEbayStockAdapter(async (name) => {
    if (name === "ReviseInventoryStatus") wrote = true;
    return { OutOfStockControlPreference: "false" };
  });
  await assert.rejects(
    adapter.reduceListing("123", 0, {
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
