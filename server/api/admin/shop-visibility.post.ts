import { getInventory } from "../../utils/inventory";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  if (typeof body?.enabled !== "boolean")
    throw createError({ statusCode: 400, statusMessage: "Choose whether to hide unavailable cards." });
  getInventory().shop.setInStockOnly(body.enabled);
  return { inStockOnly: body.enabled };
});
