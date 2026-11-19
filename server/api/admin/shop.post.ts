import { getInventory } from "../../utils/inventory";
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    if (body?.action === "create-single")
      return { saved: true, ...getInventory().shop.ensureSingle(body) };
    getInventory().shop.publish(body);
    return { saved: true, pendingSync: false };
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: e instanceof Error ? e.message : "Could not save listing.",
    });
  }
});
