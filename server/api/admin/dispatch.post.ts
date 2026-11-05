import { getInventory } from "../../utils/inventory";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  try {
    getInventory().shop.dispatch(String(body?.orderId || ""), body?.tracking);
    return { saved: true };
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : "Could not update dispatch.",
    });
  }
});
