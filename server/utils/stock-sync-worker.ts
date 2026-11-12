import type { createInventory } from "./inventory";

export type LiveListing = {
  available: number;
  sold: number;
  active: boolean;
  fixedPrice: boolean;
  variation: boolean;
  sku: string;
  tracking: string;
  duration?: string;
};
export type StockSyncDependencies = {
  inventory: ReturnType<typeof createInventory>;
  syncOrders: (owner: string) => Promise<void>;
  readListing: (itemId: string) => Promise<LiveListing>;
  updateListing: (itemId: string, quantity: number, live: LiveListing) => Promise<void>;
};

// No durable write queue: an uncertain update must be selected again by the
// seller, never retried by a timer, payment, mapping or inventory mutation.
export async function runStockSyncCycle(deps: StockSyncDependencies, cardIds: number[] = []) {
  if (!cardIds.length) return;
  if (cardIds.length > 50 || new Set(cardIds).size !== cardIds.length ||
      cardIds.some(id => !Number.isSafeInteger(id) || id < 1))
    throw new Error("Choose between 1 and 50 different cards to update.");
  const { inventory: inv } = deps;
  const state = inv.stockSync;
  state.assertIdle();
  const owner = state.acquire();
  if (!owner) throw new Error("Another eBay stock update is running.");
  const heartbeat = setInterval(() => {
    try { state.renew(owner); } catch {}
  }, 30000);
  heartbeat.unref();
  try {
    cardIds.forEach(id => state.plan(id));
    await deps.syncOrders(owner);
    state.assertOwner(owner);
    if (inv.ebay.setting("lastError") || inv.ebay.setting("notificationError"))
      throw new Error("Resolve eBay connection errors before updating selected listings.");
    state.observe();
    for (const id of cardIds) {
      state.enqueue(id);
      try {
        const plan = state.plan(id);
        if (plan.blocked) throw new Error(plan.blocked);
        if (!plan.listings.length) throw new Error("Match an active eBay listing for this card first.");
        // Duplicate listings share the website quantity. The first listing gets
        // stock and the others are zeroed; reductions precede increases.
        const changes = await Promise.all(plan.listings.map(async (listing, index) => {
          const live = await deps.readListing(listing.itemId);
          state.assertOwner(owner);
          if (!live.active || !live.fixedPrice || live.variation || live.sku !== listing.sku)
            throw new Error("Listing identity/type changed. Review its mapping before updating.");
          if (listing.sold === undefined || live.sold !== listing.sold || live.available !== listing.available)
            throw new Error("eBay stock changed during the check. Refresh and select the update again.");
          return { listing, live, quantity: index === 0 ? plan.target : 0 };
        }));
        changes.sort((a, b) => Number(a.quantity > a.live.available) - Number(b.quantity > b.live.available));
        for (const change of changes) {
          state.renew(owner);
          const current = await deps.readListing(change.listing.itemId);
          state.assertOwner(owner);
          if (!current.active || !current.fixedPrice || current.variation || current.sku !== change.live.sku ||
              current.sold !== change.live.sold || current.available !== change.live.available)
            throw new Error("eBay stock changed before the update. Refresh and select the update again.");
          if (change.quantity !== change.live.available)
            await deps.updateListing(change.listing.itemId, change.quantity, current);
          state.assertOwner(owner);
          const verified = await deps.readListing(change.listing.itemId);
          if (verified.sold !== change.live.sold || verified.available !== change.quantity)
            throw new Error("eBay stock changed during the update. Refresh and review before selecting another update.");
        }
        state.finish(id, owner, "verified");
      } catch (error) {
        state.assertOwner(owner);
        const message = error instanceof Error ? error.message : "";
        const safe = /^(Match |Multiple |Variation |Resolve |Website |Listing |eBay )/.test(message)
          ? message : "eBay update outcome is uncertain. Refresh and review before selecting another update.";
        state.finish(id, owner, "review", safe);
        throw new Error(safe);
      }
    }
    state.setSetting("stockSyncLastSuccess", new Date().toISOString());
    state.setSetting("stockSyncError", "");
  } catch (error) {
    state.setSetting("stockSyncError", "The selected eBay update did not finish. Website stock is unchanged; review before updating again.");
    throw error;
  } finally {
    clearInterval(heartbeat);
    state.release(owner);
  }
}
