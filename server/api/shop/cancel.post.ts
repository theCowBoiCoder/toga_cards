import { cancelCheckout } from "../../utils/checkout-recovery";

export default defineEventHandler(async (event) => {
  if (getHeader(event, "origin") !== getRequestURL(event).origin)
    throw createError({ statusCode: 403, statusMessage: "Same-origin request required." });
  const body = await readBody(event);
  try {
    return await cancelCheckout(String(body?.orderId || ""), body?.cancelToken);
  } catch {
    throw createError({ statusCode: 404, statusMessage: "Checkout could not be cancelled. Stock will return after confirmed expiry." });
  }
});
