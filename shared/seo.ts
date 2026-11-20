export const SITE_URL = "https://togacards.co.uk";
export const SHOP_PAGE_SIZE = 24;
export type SeoProduct = {
  id: number; player: string; club: string; number: string; variant: string;
  season: string; collection: string; condition: string; price: number | null;
  available: number; photo: string; sku?: string;
};
export function productPath(card: SeoProduct) {
  const slug = `${card.player}-${card.collection}-${card.season}-${card.number}-${card.variant}`
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `/cards/${card.id}-${slug}`;
}
export const productTitle = (card: SeoProduct) =>
  `${card.player} #${card.number} ${card.variant} – ${card.collection} ${card.season}`;
export const productDescription = (card: SeoProduct) =>
  `${card.player} ${card.club} football card: ${card.collection} ${card.season}, #${card.number}, ${card.variant}. Condition: ${card.condition}. ${card.available > 0 ? "Available from Toga Cards with combined UK postage." : "Currently out of stock at Toga Cards."}`;
export const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
export const xmlEscape = (value: string) => value.replace(/[<>&"']/g, character =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
export function productSchema(card: SeoProduct) {
  const url = SITE_URL + productPath(card);
  return {
    "@context": "https://schema.org", "@type": "Product", "@id": url + "#product",
    name: productTitle(card), description: productDescription(card), url, sku: card.sku,
    ...(card.photo ? { image: [new URL(card.photo, SITE_URL).href] } : {}),
    category: "Football trading cards",
    additionalProperty: [
      { "@type": "PropertyValue", name: "Club", value: card.club },
      { "@type": "PropertyValue", name: "Season", value: card.season },
      { "@type": "PropertyValue", name: "Condition", value: card.condition },
    ],
    ...(card.price ? { offers: {
      "@type": "Offer", url, priceCurrency: "GBP", price: (card.price / 100).toFixed(2),
      availability: `https://schema.org/${card.available > 0 ? "InStock" : "OutOfStock"}`,
      itemCondition: "https://schema.org/UsedCondition",
      seller: { "@type": "Organization", name: "Toga Cards", url: SITE_URL },
    } } : {}),
  };
}
