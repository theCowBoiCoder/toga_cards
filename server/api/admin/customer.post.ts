import { getInventory } from "../../utils/inventory";
import { startCheckout } from "../../utils/checkout-service";
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const id = body?.customerId;
  if (!Number.isSafeInteger(id) || id < 1)
    throw createError({ statusCode: 400, statusMessage: "Invalid customer." });
  const shop = getInventory().shop;
  try {
    switch (body.operation) {
      case "catalogue":
        return { products: shop.products() };
      case "orders":
        return { orders: shop.customerOrders(id) };
      case "order":
        return { order: shop.customerOrder(id, String(body.orderId || "")) };
      case "return":
        shop.requestReturn(id, String(body.orderId || ""), body.reason);
        return { saved: true };
      case "checkout":
        if (typeof body.email !== "string" || !body.email.includes("@"))
          throw new Error("Invalid customer email.");
        return await startCheckout(
          body.items,
          { id, email: body.email },
          body.shippingId,
        );
      default:
        throw new Error("Unsupported customer operation.");
    }
  } catch (error: any) {
    if (error.statusCode) throw error;
    throw createError({
      statusCode: error.message === "Order not found." ? 404 : 400,
      statusMessage: error.message || "Could not complete request.",
    });
  }
});
