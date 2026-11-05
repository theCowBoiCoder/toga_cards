import { runStockSync } from "../../utils/stock-sync-service";
import { stripeClient } from "../../utils/stripe";
import { getInventory } from "../../utils/inventory";
export default defineEventHandler(async (event) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY)
    throw createError({
      statusCode: 503,
      statusMessage: "Webhook not configured.",
    });
  const raw = await readRawBody(event),
    signature = getHeader(event, "stripe-signature");
  let notification;
  try {
    notification = stripeClient().webhooks.constructEvent(
      raw || "",
      signature || "",
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid Stripe signature.",
    });
  }
  const session = notification.data.object as any,
    shop = getInventory().shop;
  if (notification.type === "checkout.session.completed")
    shop.complete(session);
  if (notification.type === "checkout.session.expired") shop.expire(session.id);
  if (getInventory().stockSync.enabled()) void runStockSync().catch(() => {});
  return { received: true };
});
