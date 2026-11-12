import { getInventory } from "../../utils/inventory";
export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  const options = getInventory().shop.shipping.available();
  return {
    demo: process.env.TOGA_PREVIEW === "1",
    products: getInventory().shop.products(),
    checkoutReady:
      process.env.TOGA_PREVIEW !== "1" &&
      !!(
        process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_WEBHOOK_SECRET &&
        process.env.SHOP_URL &&
        options.length
      ),
    shipping: options[0]?.price ?? 0,
    shippingOptions: options,
  };
});
