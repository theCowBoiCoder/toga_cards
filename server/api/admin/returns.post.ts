import { getInventory } from "../../utils/inventory";
export default defineEventHandler(async (event) => {
  const body = await readBody(event),
    shop = getInventory().shop;
  try {
    if (body.action === "open")
      shop.openReturn(String(body.orderId), body.reason);
    else if (body.action === "restock")
      shop.restockReturn(String(body.orderId), body.cardId, body.quantity);
    else shop.reviewReturn(String(body.orderId), body.status, body.response);
    return { saved: true };
  } catch (error: any) {
    throw createError({
      statusCode: 400,
      statusMessage: error.message || "Could not update return.",
    });
  }
});
