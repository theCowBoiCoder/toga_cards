import { issueRefund, reconcileRefunds } from "../../utils/refund-service";
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  try {
    if (body.action === "reconcile") {
      await reconcileRefunds(String(body.orderId));
      return { saved: true };
    }
    return await issueRefund(
      String(body.orderId),
      body.amount,
      String(body.reason || ""),
      String(body.requestId || ""),
    );
  } catch (error: any) {
    throw createError({
      statusCode: 409,
      statusMessage: error?.type?.startsWith("Stripe")
        ? "Refund not confirmed. Check refund status before retrying."
        : error.message || "Refund not confirmed; reconcile before retrying.",
    });
  }
});
