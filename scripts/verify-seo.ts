// Isolated production-mode crawl checks. No live inventory or external API credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInventory } from "../server/utils/inventory";
import { productPath } from "../shared/seo";
const dir = await mkdtemp(join(tmpdir(), "toga-seo-"));
const inventory = createInventory(join(dir, "cards.sqlite"));
for (let index = 1; index <= 26; index++) {
  inventory.mutate({ action: "card", player: `SEO Player ${index}`, club: "Arsenal", number: String(index), season: "2026/27", collection: "Topps Flagship", variant: "Base", condition: "Near mint", quantity: 2, unitCost: 50, date: "2026-11-20" });
  inventory.shop.publish({ cardId: index, price: 199, quantity: index === 26 ? 0 : 2, stockConfirmed: true });
}
const soldOutPath = productPath(inventory.shop.products().find(card => card.id === 26)!);
inventory.close();
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOST: "127.0.0.1", PORT: "3197", DATA_DIR: dir, TOGA_PREVIEW: "0" }, stdio: "ignore",
});
const origin = "http://127.0.0.1:3197";
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin + "/shop")).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  const robots = await fetch(origin + "/robots.txt").then(response => response.text());
  assert.match(robots, /Sitemap: https:\/\/togacards.co.uk\/sitemap.xml/);
  assert.match(robots, /Disallow: \/account/);
  const sitemap = await fetch(origin + "/sitemap.xml").then(response => response.text());
  assert.equal((sitemap.match(/<loc>/g) || []).length, 29); // home, shop, page 2, 26 published cards
  assert.ok(sitemap.includes(soldOutPath));
  const second = await fetch(origin + "/shop?page=2").then(response => response.text());
  assert.equal((second.match(/class="product"/g) || []).length, 1);
  assert.match(second, /name="robots" content="index, follow, max-image-preview:large"/);
  const soldOut = await fetch(origin + soldOutPath);
  assert.equal(soldOut.status, 200);
  const html = await soldOut.text();
  assert.match(html, /"availability":"https:\/\/schema.org\/OutOfStock"/);
  assert.match(html, /Currently out of stock/);
  assert.equal((await fetch(origin + "/api/shop/products/27")).status, 404);
  assert.equal((await fetch(origin + "/social-card.png")).status, 200);
  console.log("SEO production crawl checks passed: sitemap, robots, pagination, published/sold-out cards and social image.");
  if (process.env.SEO_PREVIEW === "1") {
    console.log(`Preview: ${origin}${soldOutPath}`);
    await new Promise(resolve => process.on("SIGINT", resolve));
  }
} finally {
  server.kill();
  await new Promise(resolve => server.once("exit", resolve));
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
