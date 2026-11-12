import { getInventory } from "../../utils/inventory";
export default defineEventHandler(async (event) => {
  try {
    return getInventory().shop.shipping.save(await readBody(event));
  } catch (error: any) {
    throw createError({
      statusCode: 400,
      statusMessage: error.message || "Could not save delivery option.",
    });
  }
});
