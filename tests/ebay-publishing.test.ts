import { test } from "node:test";
import assert from "node:assert/strict";
import { XMLParser } from "fast-xml-parser";
import { createInventory } from "../server/utils/inventory";
import { createEbayPublisher, ebayPublishingContext } from "../server/utils/ebay-publishing-service";
import { decodeResponse } from "../server/utils/ebay-client";
import { listingKey } from "../server/utils/ebay-store";
import { listingDefaults } from "../server/utils/ebay-listing-payload";

const parser = new XMLParser({ parseTagValue: false });
function setup() {
  const inv = createInventory(":memory:");
  inv.mutate({ action: "card", player: "Test Player", club: "Arsenal", number: "24", variant: "Base",
    condition: "Near mint", collection: "Topps", season: "2026/27", quantity: 4, unitCost: 50, date: "2026-11-19" });
  inv.shop.publish({ cardId: 1, quantity: 4, price: 199, stockConfirmed: true, photo: "https://shop.example/card.jpg" });
  inv.ebay.setSetting("seller", "test-seller");
  inv.ebay.setSetting("tokens", "synthetic-not-a-real-token");
  const donor = { key: listingKey("123456789012", "DONOR"), itemId: "123456789012", sku: "DONOR",
    title: "A different existing listing", available: 1, sold: 0, variation: "" };
  let active = [donor];
  inv.ebay.ingest(active, [], new Date().toISOString());
  const template: any = { ItemID: donor.itemId, Seller: { UserID: "test-seller" }, Country: "GB", Currency: "GBP", Site: "UK",
    ListingType: "FixedPriceItem", PrimaryCategory: { CategoryID: "261329" }, // Only policies are inherited from this donor.
    SellingStatus: { ListingStatus: "Active", QuantitySold: "0" }, Title: donor.title, SKU: "DONOR",
    Location: "Test town", PostalCode: "TE1 1ST", DispatchTimeMax: "2", AutoPay: "true",
    PictureDetails: { PictureURL: "https://donor.example/wrong-card.jpg" },
    SellerProfiles: { SellerPaymentProfile: { PaymentProfileID: "11", PaymentProfileName: "Managed payments" },
      SellerShippingProfile: { ShippingProfileID: "22", ShippingProfileName: "Royal Mail" },
      SellerReturnProfile: { ReturnProfileID: "33", ReturnProfileName: "30-day returns" } },
    ShippingDetails: { ShippingServiceOptions: { ShippingService: "UK_RoyalMailSecondClassStandard", ShippingServiceCost: "1.55", ShippingServiceAdditionalCost: "0.00" } },
    ReturnPolicy: { ReturnsAcceptedOption: "ReturnsAccepted", ReturnsWithinOption: "Days_30", ShippingCostPaidByOption: "Buyer" } };
  let publishedItem: any;
  let failAfterCreate = false;
  let fee = "0.00";
  const calls: { name: string; body: string }[] = [];
  const deps = {
    inventory: inv,
    activeListings: async () => active,
    syncOrders: async (owner: string) => { inv.stockSync.assertOwner(owner); inv.ebay.ingest(active, [], new Date().toISOString()); },
    call: async (name: string, body: string): Promise<any> => {
      calls.push({ name, body });
      if (name === "GetItem") {
        const query = parser.parse(`<Request>${body}</Request>`).Request;
        if (query.ItemID === donor.itemId) return { Item: template };
        if (publishedItem && (query.ItemID === publishedItem.ItemID || query.SKU === publishedItem.SKU)) return { Item: publishedItem };
        throw new Error("Listing not found");
      }
      if (name === "VerifyAddFixedPriceItem") return { Fees: { Fee: { Name: "InsertionFee", Fee: { "#text": fee, "@_currencyID": "GBP" } } } };
      if (name === "AddFixedPriceItem") {
        const request = parser.parse(`<Request>${body}</Request>`).Request.Item;
        publishedItem = { ...request, ItemID: "223456789012", Seller: { UserID: "test-seller" },
          SellingStatus: { ListingStatus: "Active", QuantitySold: "0" } };
        active = [...active, { key: listingKey(publishedItem.ItemID, publishedItem.SKU), itemId: publishedItem.ItemID,
          sku: publishedItem.SKU, title: publishedItem.Title, available: Number(publishedItem.Quantity), sold: 0, variation: "" }];
        if (failAfterCreate) throw new Error("Synthetic timeout after acceptance");
        return { ItemID: publishedItem.ItemID };
      }
      throw new Error(`Unexpected test call ${name}`);
    },
  };
  const service = createEbayPublisher(deps);
  const product = inv.shop.products()[0];
  const defaults = listingDefaults(product);
  const body = { ...defaults, cardId: 1, price: 249, quantity: 2, templateId: donor.itemId };
  return { inv, service, body, calls, donor, template, deps,
    failAfterCreate: () => { failAfterCreate = true; }, setFee: (value: string) => { fee = value; },
    addActive: (listing: any) => { active.push(listing); }, getPublished: () => publishedItem };
}

test("preview verifies only; new card facts, real photos and website SKU never come from the policy donor", async () => {
  const f = setup();
  try {
    const before = f.inv.snapshot();
    const preview = await f.service.preview({ ...f.body, sku: "CLIENT-CANNOT-OVERRIDE" });
    assert.equal(preview.status, "preview");
    assert.equal(preview.preview.input.sku, "TC-S-000001");
    assert.equal(preview.preview.input.price, 249);
    assert.deepEqual(preview.preview.input.photos, ["https://shop.example/card.jpg"]);
    assert.deepEqual(f.calls.map((call) => call.name), ["GetItem", "VerifyAddFixedPriceItem"]);
    const xml = f.calls[1].body;
    assert.match(xml, /<SKU>TC-S-000001<\/SKU>/);
    assert.match(xml, /<CategoryID>261328<\/CategoryID>/);
    assert.match(xml, /<ConditionID>4000<\/ConditionID>/);
    assert.match(xml, /<Name>40001<\/Name><Value>400010<\/Value>/);
    assert.doesNotMatch(xml, /wrong-card|DONOR|A different existing listing/);
    assert.deepEqual(f.inv.snapshot(), before);
  } finally { f.inv.close(); }
});

test("publication requires confirmation and uses the frozen preview; duplicate clicks cannot publish twice", async () => {
  const f = setup();
  try {
    const preview = await f.service.preview(f.body);
    await assert.rejects(() => f.service.publish(preview.draftId, false), /confirm/);
    preview.preview.input.price = 1; // Mutating a response cannot change the stored approved payload.
    const result = await f.service.publish(preview.draftId, true);
    assert.equal(result.status, "published");
    assert.equal(result.itemId, "223456789012");
    assert.equal(f.getPublished().SKU, "TC-S-000001");
    assert.equal(f.getPublished().StartPrice, "2.49");
    assert.equal(f.getPublished().UUID, preview.draftId);
    assert.equal(f.inv.ebay.snapshot().listings.find((listing) => listing.sku === "TC-S-000001")?.cardId, 1);
    assert.equal(f.inv.ebay.snapshot().reconciliation.find((row) => row.cardId === 1)?.toAdd, 0);
    assert.equal(f.inv.snapshot().cards[0].stock, 4);
    assert.equal(f.inv.shop.products()[0].price, 199, "an eBay price must not change the website price");
    await f.service.publish(preview.draftId, true);
    assert.equal(f.calls.filter((call) => call.name === "AddFixedPriceItem").length, 1);
  } finally { f.inv.close(); }
});

test("a lost publish response remains uncertain until a read-only check finds the same SKU", async () => {
  const f = setup();
  try {
    const preview = await f.service.preview(f.body);
    f.failAfterCreate();
    assert.equal((await f.service.publish(preview.draftId, true)).status, "unknown");
    await assert.rejects(() => f.service.publish(preview.draftId, true), /Pending|uncertain/);
    await assert.rejects(() => f.service.preview(f.body), /earlier publication/);
    const result = await f.service.check(preview.draftId);
    assert.equal(result.status, "published");
    assert.equal(f.calls.filter((call) => call.name === "AddFixedPriceItem").length, 1);
    assert.equal(f.inv.snapshot().cards[0].stock, 4);
  } finally { f.inv.close(); }
});

test("current checkout holds and changed card details prevent stale publication", async () => {
  const f = setup();
  try {
    const preview = await f.service.preview(f.body);
    f.inv.shop.reserve([{ id: 1, quantity: 3 }], 0);
    await assert.rejects(() => f.service.publish(preview.draftId, true), /stock changed/);
    assert.equal(f.calls.some((call) => call.name === "AddFixedPriceItem"), false);
    assert.equal(f.inv.stockSync.status().running, false);
  } finally { f.inv.close(); }
});

test("existing live SKU or mapped card prevents a duplicate listing", async () => {
  const f = setup();
  try {
    f.addActive({ ...f.donor, itemId: "323456789012", sku: "TC-S-000001" });
    await assert.rejects(() => f.service.preview(f.body), /already has an active/);
    assert.equal(f.calls.length, 0);
  } finally { f.inv.close(); }
  const other = setup();
  try {
    other.inv.ebay.mapListing(other.donor.key, 1);
    await assert.rejects(() => other.service.preview(other.body), /already has an active/);
  } finally { other.inv.close(); }
});

test("fees or selling-policy changes require another preview before any publish request", async () => {
  const f = setup();
  try {
    const preview = await f.service.preview(f.body);
    f.setFee("0.35");
    await assert.rejects(() => f.service.publish(preview.draftId, true), /fees or warnings changed/);
    assert.equal(f.calls.some((call) => call.name === "AddFixedPriceItem"), false);
    f.setFee("0.00");
    f.template.SellerProfiles.SellerShippingProfile.ShippingProfileID = "99";
    await assert.rejects(() => f.service.publish(preview.draftId, true), /selling policies changed/);
  } finally { f.inv.close(); }
});

test("expired previews cannot publish", async (context) => {
  let clock = Date.now();
  context.mock.method(Date, "now", () => clock);
  const f = setup();
  try {
    const preview = await f.service.preview(f.body);
    clock += 16 * 60_000;
    await assert.rejects(() => f.service.publish(preview.draftId, true), /fresh preview/);
    assert.equal(f.calls.some((call) => call.name === "AddFixedPriceItem"), false);
  } finally { f.inv.close(); }
});

test("preview rejects invalid photos, duplicate specifics and unassessed or graded data", async () => {
  const f = setup();
  try {
    for (const overrides of [{ photos: "javascript:alert(1)" }, { quantity: 5 }, { condition: "275020" },
      { specifics: [{ name: "Graded", value: "Yes" }] }, { specifics: [{ name: "Graded", value: "No" }, { name: "graded", value: "No" }] }])
      await assert.rejects(() => f.service.preview({ ...f.body, ...overrides }));
    assert.equal(f.calls.length, 0);
  } finally { f.inv.close(); }
});

test("XML is escaped, and warning acceptance is limited to the opt-in listing calls", async () => {
  const f = setup();
  try {
    await f.service.preview({ ...f.body, title: "Player & <test>", description: "<script>alert(1)</script>" });
    const xml = f.calls.find((call) => call.name === "VerifyAddFixedPriceItem")!.body;
    assert.match(xml, /Player &amp; &lt;test&gt;/);
    assert.doesNotMatch(xml, /<script>/);
    const warning = '<AddFixedPriceItemResponse><Ack>Warning</Ack><ItemID>223456789012</ItemID></AddFixedPriceItemResponse>';
    assert.throws(() => decodeResponse(warning, "AddFixedPriceItem"), /warning/);
    assert.equal(decodeResponse(warning, "AddFixedPriceItem", true).ItemID, "223456789012");
  } finally { f.inv.close(); }
});

test("publication context exposes listing defaults and draft statuses without seller credentials", async () => {
  const f = setup();
  try {
    await f.service.preview(f.body);
    const context = ebayPublishingContext(f.inv);
    assert.equal(context.products[0].sku, "TC-S-000001");
    assert.equal(context.drafts.length, 1);
    assert.equal("payload" in context.drafts[0], false);
    assert.doesNotMatch(JSON.stringify(context), /synthetic-not-a-real-token/);
  } finally { f.inv.close(); }
});

test("published records prevent another preview even when the active-list read is temporarily stale", async () => {
  const f = setup();
  try {
    const preview = await f.service.preview(f.body);
    await f.service.publish(preview.draftId, true);
    f.deps.activeListings = async () => [f.donor];
    await assert.rejects(() => f.service.preview(f.body), /previous eBay listing has not been confirmed ended/);
    assert.equal(f.calls.filter((call) => call.name === "AddFixedPriceItem").length, 1);
  } finally { f.inv.close(); }
});

test("seller deletion removes saved preview payloads without altering physical stock", async () => {
  const f = setup();
  try {
    await f.service.preview(f.body);
    f.inv.ebay.setSetting("sellerEias", "synthetic-eias");
    f.inv.ebay.processAccountDeletion({ eiasToken: "synthetic-eias" });
    assert.equal(f.inv.ebayPublishing.latest().length, 0);
    assert.equal(f.inv.snapshot().cards[0].stock, 4);
    await assert.rejects(() => f.service.preview(f.body), /Connect/);
  } finally { f.inv.close(); }
});

test("an explicit dispatch postcode can complete a template whose postcode is missing or masked", async () => {
  const f = setup();
  try {
    delete f.template.PostalCode;
    await assert.rejects(() => f.service.preview(f.body), /dispatch postcode/);
    const preview = await f.service.preview({ ...f.body, postalCode: "TE1 1ST" });
    assert.equal(preview.preview.template.postalCode, "TE1 1ST");
    assert.equal((await f.service.publish(preview.draftId, true)).status, "published");
  } finally { f.inv.close(); }
});
