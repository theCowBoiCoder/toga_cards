import { runStockSync } from "../../utils/stock-sync-service";
import { getInventory } from "../../utils/inventory";
export default defineEventHandler(async (event) => {
  try {
    getInventory().shop.publish(await readBody(event));
    if (getInventory().stockSync.enabled()) void runStockSync().catch(() => {});
    return { saved: true, pendingSync: getInventory().stockSync.enabled() };
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: e instanceof Error ? e.message : "Could not save listing.",
    });
  }
});
