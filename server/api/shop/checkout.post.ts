import { startCheckout } from "../../utils/checkout-service";
export default defineEventHandler(async (event) => {
  if (getHeader(event, "origin") !== getRequestURL(event).origin)
    throw createError({
      statusCode: 403,
      statusMessage: "Same-origin request required.",
    });
  return startCheckout((await readBody(event))?.items);
});
