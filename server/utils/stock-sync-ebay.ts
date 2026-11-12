import type { LiveListing } from "./stock-sync-worker";
const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const count = (n: unknown) => {
  const value = Number(n);
  if (n == null || !Number.isSafeInteger(value) || value < 0)
    throw new Error("eBay returned an invalid stock count.");
  return value;
};
export function createEbayStockAdapter(
  call: (name: string, body: string) => Promise<any>,
) {
  return {
    readListing: async (itemId: string) => {
      const response = await call(
        "GetItem",
        `<ItemID>${escapeXml(itemId)}</ItemID>`,
      );
      const item = response.Item;
      if (!item || String(item.ItemID) !== itemId)
        throw new Error("eBay returned an unexpected listing identity.");
      const sold = count(item.SellingStatus?.QuantitySold);
      const available = count(item.Quantity) - sold;
      if (available < 0)
        throw new Error("eBay returned negative availability.");
      return {
        available,
        sold,
        active: item.SellingStatus?.ListingStatus === "Active",
        fixedPrice: item.ListingType === "FixedPriceItem",
        variation: !!item.Variations,
        sku: String(item.SKU || ""),
        duration: String(item.ListingDuration || ""),
        tracking: String(item.InventoryTrackingMethod || "ItemID"),
      };
    },
    updateListing: async (
      itemId: string,
      quantity: number,
      live: LiveListing,
    ) => {
      if (
        !Number.isSafeInteger(quantity) ||
        quantity < 0 || quantity > 1000000
      )
        throw new Error(
          "Enter a valid eBay stock quantity.",
        );
      if (quantity === 0) {
        if (live.duration !== "GTC")
          throw new Error(
            "eBay zero-stock handling requires a Good Til Cancelled listing.",
          );
        const prefs = await call(
          "GetUserPreferences",
          "<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>",
        );
        if (String(prefs.OutOfStockControlPreference) !== "true") {
          await call(
            "SetUserPreferences",
            "<OutOfStockControlPreference>true</OutOfStockControlPreference>",
          );
          const verified = await call(
            "GetUserPreferences",
            "<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>",
          );
          if (String(verified.OutOfStockControlPreference) !== "true")
            throw new Error("eBay out-of-stock control could not be verified.");
        }
      }
      const identity =
        live.tracking === "SKU"
          ? `<SKU>${escapeXml(live.sku)}</SKU>`
          : `<ItemID>${escapeXml(itemId)}</ItemID>`;
      await call(
        "ReviseInventoryStatus",
        `<InventoryStatus>${identity}<Quantity>${quantity}</Quantity></InventoryStatus>`,
      );
    },
  };
}
