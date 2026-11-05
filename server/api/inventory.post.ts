import { runStockSync } from "../utils/stock-sync-service";
import { getInventory } from "../utils/inventory";
export default defineEventHandler(async (event) => {
  const origin = getHeader(event, "origin");
  if (origin && new URL(origin).host !== getHeader(event, "host"))
    throw createError({
      statusCode: 403,
      statusMessage: "Cross-origin requests are not allowed.",
    });
  const body = await readBody(event);
  if (body?.platform === "Website")
    throw createError({
      statusCode: 400,
      statusMessage: "Website sales must come from verified Stripe payments.",
    });
  try {
    const result = getInventory().mutate(body);
    if (getInventory().stockSync.enabled()) void runStockSync().catch(() => {});
    return result;
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : "Unable to save.",
    });
  }
});
