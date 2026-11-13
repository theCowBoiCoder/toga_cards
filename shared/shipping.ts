export interface ShippingBand {
  upToCards: number;
  price: number;
}

export interface ShippingOption {
  price: number;
  packaging: number;
  bands: ShippingBand[];
}

/** Prices are integer pence. A missing band means the basket needs a manual quote. */
export function combinedPostage(option: ShippingOption, cards: number): number | null {
  if (!Number.isSafeInteger(cards) || cards < 1) return null;
  const band = option.bands.find((band) => cards <= band.upToCards);
  if (option.bands.length && !band) return null;
  return (band?.price ?? option.price) + option.packaging;
}

export function basketCardCount(items: unknown): number {
  if (!Array.isArray(items) || !items.length || items.length > 50)
    throw new Error("Choose between 1 and 50 different cards.");
  const seen = new Set<number>();
  let count = 0;
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 1 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        item.quantity > 1000000 || seen.has(item.id))
      throw new Error("Check the cards and quantities in your basket.");
    seen.add(item.id);
    count += item.quantity;
  }
  return count;
}
