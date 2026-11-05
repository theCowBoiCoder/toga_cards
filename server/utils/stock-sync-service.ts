import { createEbayStockAdapter } from "./stock-sync-ebay";
import { getInventory } from "./inventory";
import { accessToken, syncEbay } from "./ebay-service";
import { tradingCall } from "./ebay-client";
import { runStockSyncCycle } from "./stock-sync-worker";

let running: Promise<void> | undefined;
export function runStockSync(): Promise<void> {
  if (running) return running;
  running = runStockSyncCycle({
    inventory: getInventory(),
    syncOrders: syncEbay,
    ...createEbayStockAdapter(async (name, body) => {
      if (
        !getInventory().stockSync.enabled() ||
        getInventory().ebay.setting("accountDeleted")
      )
        throw new Error("Stock synchronisation has been paused.");
      const token = await accessToken();
      if (
        !getInventory().stockSync.enabled() ||
        getInventory().ebay.setting("accountDeleted")
      )
        throw new Error("Stock synchronisation has been paused.");
      return tradingCall(token, name, body);
    }),
  }).finally(() => {
    running = undefined;
  });
  return running;
}
