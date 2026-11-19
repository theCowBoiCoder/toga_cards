import { getInventory } from "./inventory";
import { stripeClient } from "./stripe";
import { checkoutCredential } from "./checkout-store";

// Only use this for the initial create call, before a session has been returned.
// A timeout, 5xx or idempotency conflict can conceal a successful creation.
export function definitiveCheckoutRejection(error: any) {
  return ["StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError"].includes(error?.type) &&
    [400, 401, 403, 404, 422].includes(error?.statusCode) &&
    error?.code !== "idempotency_key_in_use" && error?.raw?.type !== "idempotency_error" &&
    error?.headers?.["stripe-should-retry"] !== "true";
}

export function checkoutErrorCode(error: any) {
  const code = String(error?.code || error?.type || "RECONCILIATION_FAILED");
  return /^[A-Za-z0-9_]{1,80}$/.test(code) ? code : "RECONCILIATION_FAILED";
}

type Shop = ReturnType<typeof getInventory>["shop"];
type Claim = NonNullable<ReturnType<Shop["checkouts"]["claim"]>>;

async function reconcileClaim(claim: Claim, stripe: ReturnType<typeof stripeClient>, shop: Shop) {
  const { order, attempt, token } = claim;
  let errorCode = "";
  let delay = 60_000;
  try {
    let sessionId = order.session_id;
    if (!sessionId) {
      if (!attempt.request || attempt.credential !== checkoutCredential() ||
        Date.now() - attempt.created_at >= 23 * 60 * 60_000) {
        errorCode = "MANUAL_REVIEW_REQUIRED";
        delay = 24 * 60 * 60_000;
        return;
      }
      // Recover an ambiguous create using its exact original body and key.
      // Never infer absence from a later API error or replay past key retention.
      const recovered = await stripe.checkout.sessions.create(JSON.parse(attempt.request), { idempotencyKey: order.id });
      sessionId = recovered.id;
      shop.attach(order.id, sessionId);
    }
    let session = await stripe.checkout.sessions.retrieve(sessionId);
    const matches = () => session.id === sessionId && session.metadata?.orderId === order.id &&
      session.client_reference_id === order.id;
    if (!matches()) throw Object.assign(new Error("Checkout identity mismatch"), { code: "SESSION_MISMATCH" });
    if (session.payment_status === "paid") {
      shop.complete(session);
      return;
    }
    if (session.status === "open" && (shop.checkouts.cancellationRequested(order.id) || session.expires_at <= Date.now() / 1000)) {
      try {
        session = await stripe.checkout.sessions.expire(sessionId);
      } catch {
        // Payment can win the race with expiry, or expiry can succeed despite a
        // lost response. Retrieve the outcome before deciding what stock does.
        session = await stripe.checkout.sessions.retrieve(sessionId);
      }
    }
    if (!matches()) throw Object.assign(new Error("Checkout identity mismatch"), { code: "SESSION_MISMATCH" });
    if (session.payment_status === "paid") shop.complete(session);
    else if (session.status === "expired" && session.payment_status === "unpaid") shop.expire(sessionId);
  } catch (error) {
    errorCode = checkoutErrorCode(error);
  } finally {
    shop.checkouts.finish(order.id, token, errorCode, delay);
  }
}

export async function recoverCheckouts(stripe = stripeClient(), shop = getInventory().shop) {
  for (let count = 0; count < 20; count++) {
    const claim = shop.checkouts.claim();
    if (!claim) break;
    await reconcileClaim(claim, stripe, shop);
  }
}

export async function cancelCheckout(orderId: string, cancelToken: unknown, stripe = stripeClient(), shop = getInventory().shop) {
  shop.checkouts.requestCancel(orderId, cancelToken);
  const claim = shop.checkouts.claim(orderId);
  if (claim) await reconcileClaim(claim, stripe, shop);
  return { status: shop.order(orderId)?.status || "pending" };
}
