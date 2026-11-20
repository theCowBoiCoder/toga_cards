import { test } from "node:test";
import assert from "node:assert/strict";
import { productPath, productSchema, jsonLd, xmlEscape } from "../shared/seo";
const card = { id: 42, player: "João <Test>", club: "Arsenal", number: "A/1", variant: "Base", season: "2026/27", collection: "Topps Flagship", condition: "Near mint", price: 199, available: 2, photo: "/storage/cards/test.webp", sku: "TC-S-000042" };
test("card URLs are stable, readable and do not include unsafe characters", () => {
  assert.equal(productPath(card), "/cards/42-joao-test-topps-flagship-2026-27-a-1-base");
});
test("product offers match prices and stock, without fabricated images or ratings", () => {
  const schema = productSchema(card);
  assert.equal(schema.offers?.price, "1.99");
  assert.equal(schema.offers?.availability, "https://schema.org/InStock");
  assert.deepEqual(schema.image, ["https://togacards.co.uk/storage/cards/test.webp"]);
  assert.equal("aggregateRating" in schema, false);
  assert.equal(productSchema({ ...card, available: 0 }).offers?.availability, "https://schema.org/OutOfStock");
  assert.equal("image" in productSchema({ ...card, photo: "" }), false);
});
test("structured data cannot close its script and sitemap text is XML escaped", () => {
  const value = { name: "</script><script>alert(1)</script>" };
  assert.equal(jsonLd(value).includes("<"), false);
  assert.deepEqual(JSON.parse(jsonLd(value)), value);
  assert.equal(xmlEscape("/shop?a=1&b=<x>"), "/shop?a=1&amp;b=&lt;x&gt;");
});
