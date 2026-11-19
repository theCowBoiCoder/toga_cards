import { getInventory } from "./inventory";
import { stripeClient } from "./stripe";
import { basketCardCount } from "../../shared/shipping";
import { randomBytes } from "node:crypto";
import { checkoutErrorCode, definitiveCheckoutRejection } from "./checkout-recovery";
export async function startCheckout(
  items: unknown,
  customer?: { id: number; email: string },
  shippingId?: unknown,
) {
  const base = process.env.SHOP_URL;
  if (
    process.env.TOGA_PREVIEW === "1" ||
    !base ||
    !process.env.STRIPE_SECRET_KEY ||
    !process.env.STRIPE_WEBHOOK_SECRET
  )
    throw createError({
      statusCode: 503,
      statusMessage:
        "Checkout is awaiting shop setup. Your basket has been kept.",
    });
  const stripe = stripeClient(),
    shop = getInventory().shop;
  const cancelToken = randomBytes(32).toString("hex");
  let prepared: ReturnType<typeof shop.checkouts.prepare<ReturnType<typeof shop.reserve>>>;
  try {
    const delivery = shop.shipping.select(shippingId, basketCardCount(items));
    prepared = shop.checkouts.prepare(
      () => shop.reserve(items, delivery.price, customer?.id, delivery.name),
      (order) => ({
        mode: "payment",
        ...(customer ? { customer_email: customer.email } : {}),
        client_reference_id: order.id,
        metadata: { orderId: order.id },
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        success_url: customer
          ? `${base.replace(/\/$/, "")}/account/orders/${order.id}?checkout=success`
          : `${base.replace(/\/$/, "")}/?checkout=success`,
        cancel_url: `${base.replace(/\/$/, "")}/shop?checkout=cancelled&order=${order.id}`,
        shipping_address_collection: { allowed_countries: ["GB"] },
        shipping_options: [
          {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: { amount: delivery.price, currency: "gbp" },
              display_name: delivery.name,
              ...(delivery.min_days !== null
                ? {
                    delivery_estimate: {
                      minimum: {
                        unit: "business_day" as const,
                        value: delivery.min_days,
                      },
                      maximum: {
                        unit: "business_day" as const,
                        value: delivery.max_days,
                      },
                    },
                  }
                : {}),
            },
          },
        ],
        line_items: order.lines.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: "gbp",
            unit_amount: l.price,
            product_data: {
              name: `${l.player} #${l.number} · ${l.variant}`,
              description: `${l.collection} ${l.season} · ${l.condition}`,
            },
          },
        })),
      }),
      cancelToken,
    );
  } catch (e) {
    throw createError({ statusCode: 409, statusMessage: e instanceof Error ? e.message : "Check basket availability." });
  }
  const { order, request, token } = prepared;
  let receivedSession = false;
  try {
    const session = await stripe.checkout.sessions.create(request, { idempotencyKey: order.id });
    receivedSession = true;
    shop.attach(order.id, session.id);
    shop.checkouts.finish(order.id, token);
    return { url: session.url, orderId: order.id, cancelToken };
  } catch (error) {
    const rejected = !receivedSession && definitiveCheckoutRejection(error);
    if (rejected) shop.release(order.id);
    shop.checkouts.finish(order.id, token, checkoutErrorCode(error));
    throw createError({
      statusCode: 502,
      statusMessage: rejected
        ? "Checkout could not be opened. Reserved stock has been returned; your basket is saved."
        : "Could not open checkout. Stock is held while we check Stripe; please contact the shop before trying again.",
    });
  }
}
