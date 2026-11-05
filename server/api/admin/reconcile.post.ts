import { getInventory } from "../../utils/inventory";
import { stripeClient } from "../../utils/stripe";
export default defineEventHandler(async (event) => {
  const body = await readBody(event),
    shop = getInventory().shop;
  const order = shop.order(String(body?.orderId || ""));
  if (!order?.session_id)
    throw createError({
      statusCode: 409,
      statusMessage:
        "No linked session. Find this order reference in Stripe before releasing any stock.",
    });
  try {
    const session = await stripeClient().checkout.sessions.retrieve(
      order.session_id,
    );
    if (session.payment_status === "paid") shop.complete(session);
    else if (session.status === "expired") shop.expire(session.id);
    return { status: shop.order(order.id).status };
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage:
        "Stripe reconciliation failed. Stock remains held; inspect the order in Stripe.",
    });
  }
});
