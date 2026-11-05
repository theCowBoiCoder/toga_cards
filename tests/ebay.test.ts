import { test } from "node:test";
import assert from "node:assert/strict";
import { createInventory } from "../server/utils/inventory";
import { listingKey, type EbayOrder } from "../server/utils/ebay-store";
import {
  decodeResponse,
  parseListings,
  parseOrders,
  fetchEbaySnapshot,
} from "../server/utils/ebay-client";

const now = () => new Date().toISOString();
const listing = {
  key: listingKey("123", "CARD-1"),
  itemId: "123",
  sku: "CARD-1",
  variation: "",
  title: "Test single card",
  available: 4,
};
const order = (overrides: Partial<EbayOrder> = {}): EbayOrder => ({
  key: "order-1",
  orderId: "ebay-order-1",
  itemId: "123",
  sku: "CARD-1",
  variation: "",
  title: "Test single card",
  quantity: 1,
  gross: 500,
  currency: "GBP",
  created: now(),
  paid: true,
  cancelled: false,
  ...overrides,
});
function setup(quantity = 5) {
  const inv = createInventory(":memory:");
  inv.mutate({
    action: "card",
    player: "Test",
    club: "Test",
    season: "2026/27",
    collection: "Test",
    number: "1",
    variant: "Base",
    condition: "Near mint",
    quantity,
    unitCost: 100,
    date: "2026-09-08",
  });
  return inv;
}
test("stocktake mode imports orders without deducting and reviewed sales apply only once", () => {
  const inv = setup(),
    o = order();
  inv.ebay.ingest([listing], [o], now());
  inv.ebay.mapListing(listing.key, 1);
  assert.equal(inv.snapshot().cards[0].stock, 5);
  inv.ebay.reviewOrder(o.key, "apply", 50);
  inv.ebay.reviewOrder(o.key, "apply", 50);
  inv.ebay.ingest([listing], [o], now());
  assert.equal(inv.snapshot().cards[0].stock, 4);
  assert.equal(inv.snapshot().sales.length, 1);
  assert.equal((inv.snapshot().sales[0] as any).fees, 50);
  assert.equal(inv.ebay.snapshot().orders[0].saleId, 1);
  inv.close();
});
test("automatic sales respect cutover and keep old, unpaid, unmatched and short-stock orders for review", () => {
  const inv = setup(1),
    cutover = "2026-09-08T12:00:00.000Z";
  inv.ebay.ingest([listing], [], now());
  inv.ebay.mapListing(listing.key, 1);
  inv.ebay.setSetting("autoSince", cutover);
  const orders = [
    order({ key: "old", created: "2026-09-08T11:00:00.000Z" }),
    order({ key: "unpaid", paid: false, created: cutover }),
    order({ key: "unmatched", sku: "other", created: cutover }),
    order({ key: "valid", created: cutover }),
    order({ key: "short", created: cutover }),
  ];
  inv.ebay.ingest([listing], orders, now());
  assert.equal(inv.snapshot().sales.length, 1);
  assert.equal(inv.snapshot().cards[0].stock, 0);
  assert.equal(
    inv.ebay.snapshot().orders.find((o) => o.key === "valid").feesConfirmed,
    false,
  );
  assert.match(
    inv.ebay.snapshot().orders.find((o) => o.key === "short").issue,
    /Insufficient/,
  );
  inv.ebay.ingest([listing], orders, now());
  assert.equal(inv.snapshot().sales.length, 1);
  inv.ebay.reviewOrder("valid", "fees", 75);
  assert.equal((inv.snapshot().sales[0] as any).fees, 75);
  inv.close();
});
test("reconciliation adds listings to existing stock once and blocks pre-baseline automatic sales", () => {
  const inv = setup(1),
    second = {
      ...listing,
      key: listingKey("456", "CARD-1"),
      itemId: "456",
      available: 2,
    };
  inv.ebay.ingest([listing, second], [], now());
  inv.ebay.mapListing(listing.key, 1);
  inv.ebay.mapListing(second.key, 1);
  assert.equal(inv.ebay.reconcile(), 1);
  assert.equal(inv.snapshot().cards[0].stock, 7);
  assert.equal(inv.ebay.reconcile(), 0);
  inv.ebay.setSetting("autoSince", "2020-01-01T00:00:00.000Z");
  inv.ebay.ingest(
    [{ ...listing, available: 1 }],
    [order({ created: "2021-01-01T00:00:00.000Z" })],
    now(),
  );
  assert.equal(inv.snapshot().sales.length, 0);
  assert.equal(inv.ebay.reconcile(), 0);
  assert.equal(inv.snapshot().cards[0].stock, 7);
  inv.close();
});
test("refunds or changed applied orders are flagged without restocking or another sale", () => {
  const inv = setup(),
    o = order();
  inv.ebay.ingest([listing], [o], now());
  inv.ebay.mapListing(listing.key, 1);
  inv.ebay.reviewOrder(o.key, "apply", 0);
  inv.ebay.ingest([], [{ ...o, cancelled: true }], now());
  assert.equal(inv.snapshot().cards[0].stock, 4);
  assert.equal(inv.snapshot().sales.length, 1);
  assert.match(inv.ebay.snapshot().orders[0].issue, /changed or refunded/);
  inv.close();
});
test("already-counted orders never deduct; failed snapshot import preserves previous listing state", () => {
  const inv = setup(),
    o = order();
  inv.ebay.ingest([listing], [o], now());
  inv.ebay.mapListing(listing.key, 1);
  inv.ebay.reviewOrder(o.key, "already-counted", 0);
  inv.ebay.setSetting("autoSince", "2020-01-01T00:00:00.000Z");
  inv.ebay.ingest([listing], [o], now());
  assert.equal(inv.snapshot().cards[0].stock, 5);
  assert.throws(
    () => inv.ebay.ingest([listing, listing], [], now()),
    /Duplicate/,
  );
  assert.equal(inv.ebay.snapshot().listings[0].active, true);
  inv.close();
});
test("Trading XML preserves IDs and normalises per-variation remaining stock", () => {
  const xml = `<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult><ItemArray><Item><ItemID>00123</ItemID><Title>Cards</Title><Variations><Variation><SKU>001</SKU><Quantity>10</Quantity><SellingStatus><QuantitySold>3</QuantitySold></SellingStatus></Variation><Variation><SKU>002</SKU><Quantity>5</Quantity><SellingStatus><QuantitySold>4</QuantitySold></SellingStatus></Variation></Variations></Item></ItemArray></ActiveList></GetMyeBaySellingResponse>`;
  const listings = parseListings(decodeResponse(xml, "GetMyeBaySelling"));
  assert.deepEqual(
    listings.map((l) => l.available),
    [7, 1],
  );
  assert.equal(listings[0].sku, "001");
  assert.equal(listings[0].itemId, "00123");
  assert.throws(() =>
    decodeResponse(
      "<GetMyeBaySellingResponse><Ack>Failure</Ack></GetMyeBaySellingResponse>",
      "GetMyeBaySelling",
    ),
  );
});
test("order parsing uses paid status, stable references and integer price totals", () => {
  const xml = `<GetOrdersResponse><Ack>Success</Ack><HasMoreOrders>false</HasMoreOrders><OrderArray><Order><OrderID>00001</OrderID><OrderStatus>Completed</OrderStatus><PaidTime>2026-09-08T12:00:00Z</PaidTime><CheckoutStatus><Status>Complete</Status><eBayPaymentStatus>NoPaymentFailure</eBayPaymentStatus></CheckoutStatus><TransactionArray><Transaction><OrderLineItemID>123-0002</OrderLineItemID><Item><ItemID>123</ItemID><SKU>CARD-1</SKU><Title>Test card</Title></Item><CreatedDate>2026-09-08T12:00:00Z</CreatedDate><QuantityPurchased>3</QuantityPurchased><TransactionPrice currencyID="GBP">1.25</TransactionPrice></Transaction></TransactionArray></Order></OrderArray></GetOrdersResponse>`;
  const o = parseOrders(decodeResponse(xml, "GetOrders"))[0];
  assert.equal(o.gross, 375);
  assert.equal(o.paid, true);
  assert.equal(o.cancelled, false);
  assert.equal(o.currency, "GBP");
});
test('long history uses contiguous windows below 30 days and resets pagination', async () => {
  const windows: [number, number, number][] = [];
  await fetchEbaySnapshot('test', '2026-06-11T00:00:00Z', '2026-09-08T00:00:00Z', async (_token, name, body) => {
    if (name === 'GetMyeBaySelling') return { ActiveList: { PaginationResult: { TotalNumberOfPages: 0 } } };
    const from = Date.parse(body.match(/<ModTimeFrom>(.*?)<\/ModTimeFrom>/)![1]);
    const to = Date.parse(body.match(/<ModTimeTo>(.*?)<\/ModTimeTo>/)![1]);
    const page = Number(body.match(/<PageNumber>(.*?)<\/PageNumber>/)![1]);
    windows.push([from, to, page]);
    return { HasMoreOrders: page === 1 ? 'true' : 'false' };
  });
  assert.equal(windows.length, 8);
  assert.equal(windows[0][0], Date.parse('2026-06-11T00:00:00Z'));
  assert.equal(windows.at(-1)![1], Date.parse('2026-09-08T00:00:00Z'));
  windows.forEach(([from, to, page], i) => {
    assert.ok(to > from && to - from < 30 * 86400000);
    assert.equal(page, i % 2 + 1);
    if (i && page === 1) assert.equal(from, windows[i - 1][1]);
  });
});

test("pagination fetches all pages and rejects partial failures", async () => {
  let pages = 0;
  const call = async (_token: string, name: string) =>
    name === "GetMyeBaySelling"
      ? {
          Ack: "Success",
          ActiveList: {
            PaginationResult: { TotalNumberOfPages: "2" },
            ItemArray: {
              Item: {
                ItemID: String(++pages),
                Title: "Test",
                QuantityAvailable: "2",
              },
            },
          },
        }
      : { Ack: "Success", HasMoreOrders: "false" };
  const result = await fetchEbaySnapshot(
    "test",
    "2026-09-01T00:00:00Z",
    "2026-09-08T00:00:00Z",
    call,
  );
  assert.equal(result.listings.length, 2);
  await assert.rejects(
    () =>
      fetchEbaySnapshot(
        "test",
        "2026-09-01T00:00:00Z",
        "2026-09-08T00:00:00Z",
        async () => {
          throw new Error("HTTP 429");
        },
      ),
    /429/,
  );
});
