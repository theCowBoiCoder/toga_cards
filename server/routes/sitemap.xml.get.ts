import { SITE_URL, SHOP_PAGE_SIZE, productPath, xmlEscape } from "#shared/seo";
import { getInventory } from "../utils/inventory";
export default defineEventHandler(event => {
  setHeader(event, "Content-Type", "application/xml; charset=utf-8");
  setHeader(event, "Cache-Control", "no-store");
  const shop = getInventory().shop;
  const paths = ["/", "/shop"];
  if (process.env.TOGA_PREVIEW !== "1") {
    const pages = Math.ceil(shop.publicCatalogue().products.length / SHOP_PAGE_SIZE);
    for (let page = 2; page <= pages; page++) paths.push(`/shop?page=${page}`);
    for (const card of shop.products().filter(card => card.price)) paths.push(productPath(card));
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${xmlEscape(SITE_URL + path)}</loc></url>`).join("")}</urlset>`;
});
