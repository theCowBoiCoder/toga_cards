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
  reduceListing: (
    itemId: string,
    quantity: number,
    live: LiveListing,
  ) => Promise<void>;
};

export async function runStockSyncCycle(deps: StockSyncDependencies) {
  const { inventory: inv } = deps,
    state = inv.stockSync;
  if (!state.enabled()) return;
  const owner = state.acquire();
  if (!owner) return;
  const heartbeat = setInterval(() => {
    try {
      state.renew(owner);
    } catch {}
  }, 30000);
  heartbeat.unref();
  try {
    await deps.syncOrders(owner);
    state.assertOwner(owner);
    if (
      !inv.ebay.setting("autoSince") ||
      inv.ebay.setting("lastError") ||
      inv.ebay.setting("notificationError")
    )
      throw new Error(
        "Resolve eBay connection errors and finish stocktake before syncing quantities.",
      );
    state.observe();
    state.enqueueAll();
    for (const job of state.jobs()) {
      state.renew(owner);
      let p = state.plan(job.card_id);
      if (
        job.signature === p.signature &&
        (job.status === "verified" || job.retry_at > Date.now())
      )
        continue;
      try {
        if (p.listings.some((l) => l.variation)) throw new Error(p.blocked);
        const keys = p.listings.map((l) => l.key);
        for (const key of keys) {
          p = state.plan(job.card_id);
          const listing = p.listings.find((l) => l.key === key);
          if (!listing)
            throw new Error(
              "Listing identity changed during stock reconciliation.",
            );
          let remaining = p.target;
          let target = 0;
          for (const row of p.listings) {
            const allocated = Math.min(row.available, remaining);
            remaining -= allocated;
            if (row.key === key) target = allocated;
          }
          // A shared inventory pool is distributed across duplicate listings,
          // never copied in full to each listing. This path only reduces stock.
          const needsRemote =
            listing.available > target || p.requested > p.current;
          if (!needsRemote) continue;
          const before = await deps.readListing(listing.itemId);
          state.assertOwner(owner);
          if (
            !before.active ||
            !before.fixedPrice ||
            before.variation ||
            before.sku !== listing.sku
          )
            throw new Error(
              "Listing identity/type changed. Review its mapping before retrying.",
            );
          if (
            listing.sold === undefined ||
            before.sold !== listing.sold ||
            before.available !== listing.available
          )
            throw new Error(
              "eBay availability or sold count changed. Waiting for the next order sync.",
            );
          if (before.available > target) {
            await deps.reduceListing(listing.itemId, target, before);
            state.assertOwner(owner);
          }
          let after = await deps.readListing(listing.itemId);
          state.assertOwner(owner);
          if (after.sold !== before.sold || after.available > target) {
            if (after.available > 0) {
              await deps.reduceListing(listing.itemId, 0, after);
              state.assertOwner(owner);
            }
            throw new Error(
              "Sale or quantity change occurred during transfer. eBay stock was quarantined; website stock remains held for reconciliation.",
            );
          }
          await deps.syncOrders(owner);
          state.assertOwner(owner);
          state.observe();
          p = state.plan(job.card_id);
          const latest = p.listings.find((l) => l.key === key);
          if (
            !latest ||
            latest.sold !== after.sold ||
            latest.available !== after.available
          )
            throw new Error(
              "Post-update marketplace snapshot differs. Stock remains held for reconciliation.",
            );
          after = await deps.readListing(listing.itemId);
          state.assertOwner(owner);
          if (
            after.sold !== latest.sold ||
            after.available !== latest.available
          )
            throw new Error(
              "Marketplace changed before transfer completed. Retrying after order sync.",
            );
        }
        p = state.plan(job.card_id);
        if (p.listings.reduce((n, l) => n + l.available, 0) > p.target)
          throw new Error(
            "Stock remains overallocated across eBay listings. Retrying verified reductions.",
          );
        if (p.requested > p.current) {
          for (const listing of p.listings) {
            const live = await deps.readListing(listing.itemId);
            state.assertOwner(owner);
            if (
              live.sold !== listing.sold ||
              live.available !== listing.available
            )
              throw new Error(
                "Marketplace changed before website allocation was activated.",
              );
          }
        }
        if (p.blocked) throw new Error(p.blocked);
        // No live listing means no eBay exposure for this mapped card. Unknown
        // active listings still block all newly requested website allocations.
        state.activate(job.card_id, owner);
        state.finish(job.card_id, owner, "verified");
      } catch (error) {
        state.assertOwner(owner);
        const message = error instanceof Error ? error.message : "";
        const safe =
          /^(Multiple |Variation |Resolve |Website |Match |Listing |eBay |Sale |Post-update |Marketplace |Stock |This workspace)/.test(
            message,
          )
            ? message
            : "eBay update outcome is uncertain. Live quantities will be checked before retrying.";
        state.finish(job.card_id, owner, "retry", safe);
      }
    }
    state.setSetting("stockSyncLastSuccess", new Date().toISOString());
    state.setSetting("stockSyncError", "");
  } catch {
    state.setSetting(
      "stockSyncError",
      "Stock sync could not finish. Check the eBay connection and order review queue; website availability is paused.",
    );
    throw new Error(
      "Stock sync could not finish. Existing allocations remain reserved.",
    );
  } finally {
    clearInterval(heartbeat);
    state.release(owner);
  }
}
