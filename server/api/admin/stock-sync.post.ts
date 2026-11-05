import { getInventory } from "../../utils/inventory";
import { runStockSync } from "../../utils/stock-sync-service";
export default defineEventHandler(async (event) => {
  const body = await readBody(event),
    inv = getInventory();
  try {
    if (body?.action === "pause") {
      inv.stockSync.pause();
      return inv.stockSync.status();
    }
    if (body?.action === "enable") inv.stockSync.enable();
    else if (body?.action === "sync") inv.stockSync.retryNow();
    else if (body?.action !== "sync")
      throw new Error("Unknown stock synchronisation action.");
    void runStockSync().catch(() => {});
    return { queued: true, ...inv.stockSync.status() };
  } catch (e) {
    throw createError({
      statusCode: 409,
      statusMessage: e instanceof Error ? e.message : "Stock sync failed.",
    });
  }
});
