import { getInventory } from "./inventory";
import { stripeClient } from "./stripe";
import { basketCardCount } from "../../shared/shipping";
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
  let order: ReturnType<typeof shop.reserve>;
  let delivery: ReturnType<typeof shop.shipping.select>;
  try {
    delivery = shop.shipping.select(shippingId, basketCardCount(items));
    order = shop.reserve(items, delivery.price, customer?.id, delivery.name);
  } catch (e) {
    throw createError({
      statusCode: 409,
      statusMessage:
        e instanceof Error ? e.message : "Check basket availability.",
    });
  }
  // Keep reservations on ambiguous network failures: releasing could sell stock twice.
  // Admin can reconcile the order against Stripe using this idempotency key.
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        ...(customer ? { customer_email: customer.email } : {}),
        payment_method_types: ["card"],
        client_reference_id: order.id,
        metadata: { orderId: order.id },
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        success_url: customer
          ? `${base.replace(/\/$/, "")}/account/orders/${order.id}?checkout=success`
          : `${base.replace(/\/$/, "")}/?checkout=success`,
        cancel_url: `${base.replace(/\/$/, "")}/shop?checkout=cancelled`,
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
      },
      { idempotencyKey: order.id },
    );
    shop.attach(order.id, session.id);
    return { url: session.url };
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage:
        "Could not open checkout. Stock is held for review; please contact the shop before trying again.",
    });
  }
}
