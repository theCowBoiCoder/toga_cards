import { getInventory } from "../../utils/inventory";
export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  return {
    demo: process.env.TOGA_PREVIEW === "1",
    products: getInventory().shop.products(),
    checkoutReady:
      process.env.TOGA_PREVIEW !== "1" &&
      !!(
        process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_WEBHOOK_SECRET &&
        process.env.SHOP_URL &&
        process.env.SHOP_SHIPPING_PENCE
      ),
    shipping: Number(process.env.SHOP_SHIPPING_PENCE || 0),
  };
});
