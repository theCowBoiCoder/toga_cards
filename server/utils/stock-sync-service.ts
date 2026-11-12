import { createEbayStockAdapter } from "./stock-sync-ebay";
import { getInventory } from "./inventory";
import { accessToken, syncEbay } from "./ebay-service";
import { tradingCall } from "./ebay-client";
import { runStockSyncCycle } from "./stock-sync-worker";

let running = false;
export async function runStockSync(cardIds: number[] = []): Promise<void> {
  if (!cardIds.length) return;
  if (running) throw new Error("Another eBay stock update is running.");
  running = true;
  try {
    await runStockSyncCycle({
      inventory: getInventory(),
      syncOrders: syncEbay,
      ...createEbayStockAdapter(async (name, body) => {
        if (getInventory().ebay.setting("accountDeleted"))
          throw new Error("This workspace seller account has been deleted.");
        const token = await accessToken();
        if (getInventory().ebay.setting("accountDeleted"))
          throw new Error("This workspace seller account has been deleted.");
        return tradingCall(token, name, body);
      }),
    }, cardIds);
  } finally { running = false; }
}
