import { getInventory } from "../../utils/inventory";
import { runStockSync } from "../../utils/stock-sync-service";
export default defineEventHandler(async (event) => {
  const body = await readBody(event),
    inv = getInventory();
  try {
    if (body?.action !== "sync" || !Array.isArray(body.cardIds) || !body.cardIds.length)
      throw new Error("Select the cards whose eBay quantities you want to update.");
    await runStockSync(body.cardIds);
    return { updated: true, ...inv.stockSync.status() };
  } catch (e) {
    throw createError({
      statusCode: 409,
      statusMessage: e instanceof Error ? e.message : "Stock sync failed.",
    });
  }
});
