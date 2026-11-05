import { getInventory } from "../utils/inventory";
import { syncEbay } from "../utils/ebay-service";
import { runStockSync } from "../utils/stock-sync-service";
import { pollEbayNotifications } from "../utils/ebay-notifications";
export default defineNitroPlugin((nitro) => {
  if (process.env.TOGA_PREVIEW === "1") return;
  const check = () => {
    if (process.env.EBAY_RELAY_URL)
      void pollEbayNotifications().catch(() => {});
  };
  let previousImport = 0;
  const tick = () => {
    const inv = getInventory();
    if (inv.stockSync.enabled()) void runStockSync().catch(() => {});
    else if (
      inv.ebay.setting("tokens") &&
      Date.now() - previousImport > 15 * 60 * 1000
    ) {
      previousImport = Date.now();
      void syncEbay().catch(() => {});
    }
  };
  check();
  tick();
  const notifications = setInterval(check, 60000);
  notifications.unref();
  const timer = setInterval(tick, 120000);
  timer.unref();
  nitro.hooks.hook("close", () => {
    clearInterval(timer);
    clearInterval(notifications);
  });
});
