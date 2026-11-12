import { getInventory } from "./inventory";
import { stripeClient } from "./stripe";

export async function reconcileRefunds(
  orderId: string,
  stripe = stripeClient(),
  shop = getInventory().shop,
) {
  const order = shop.order(orderId);
  if (!order?.session_id || order.status !== "paid")
    throw new Error("Choose a paid order with a linked Stripe session.");
  const session = await stripe.checkout.sessions.retrieve(order.session_id);
  if (
    session.payment_status !== "paid" ||
    session.amount_total !== order.total ||
    session.currency !== "gbp" ||
    session.metadata?.orderId !== order.id
  )
    throw new Error("Stripe payment does not match order.");
  const pi =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!pi) throw new Error("Payment identity is missing.");
  shop.bindPayment(order.id, pi);
  for await (const refund of stripe.refunds.list({
    payment_intent: pi,
    limit: 100,
  }))
    shop.recordRefund(refund);
  return pi;
}
export async function issueRefund(
  orderId: string,
  amount: number,
  reason: string,
  requestId: string,
  stripe = stripeClient(),
  shop = getInventory().shop,
) {
  if (process.env.TOGA_PREVIEW === "1")
    throw new Error("Refunds are disabled in preview.");
  const pi = await reconcileRefunds(orderId, stripe, shop);
  const request = shop.prepareRefund(orderId, amount, reason, requestId);
  if (request.stripe_id) {
    const current = await stripe.refunds.retrieve(request.stripe_id);
    shop.recordRefund(current);
    return { status: current.status };
  }
  // The persisted request survives timeouts; retries reuse this key and amount.
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: pi,
        amount: request.amount,
        metadata: { orderId, refundId: request.id },
      },
      { idempotencyKey: `toga-refund-${request.id}` },
    );
    shop.recordRefund(refund);
    return { status: refund.status };
  } catch (error: any) {
    if (error.type === "StripeInvalidRequestError")
      shop.failRefundRequest(request.id);
    throw error;
  }
}

export async function synchronizeRefund(
  refundId: string,
  stripe = stripeClient(),
  shop = getInventory().shop,
) {
  const refund = await stripe.refunds.retrieve(refundId);
  if (shop.recordRefund(refund)) return;
  const paymentIntent =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id;
  if (!paymentIntent) return;
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntent,
    limit: 1,
  });
  const session = sessions.data[0];
  const order = session?.metadata?.orderId
    ? shop.order(session.metadata.orderId)
    : null;
  if (!order || order.session_id !== session.id) return;
  if (
    session.payment_status !== "paid" ||
    session.amount_total !== order.total ||
    session.currency !== "gbp"
  )
    throw new Error("Refund payment does not match order.");
  // Refund events can arrive before the payment-completed event.
  shop.complete(session);
  shop.bindPayment(order.id, paymentIntent);
  shop.recordRefund(refund);
}
