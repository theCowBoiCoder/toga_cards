import { getInventory } from "../../utils/inventory";
export default defineEventHandler(async (event) => {
  try {
    getInventory().shop.publish(await readBody(event));
    return { saved: true, pendingSync: false };
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: e instanceof Error ? e.message : "Could not save listing.",
    });
  }
});
