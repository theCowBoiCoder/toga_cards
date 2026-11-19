import { createHash } from "node:crypto";

export const xmlText = (value: unknown) => String(value ?? "").replace(/[<>&"']/g,
  (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
export const ebayText = (value: any): string => String(value?.["#text"] ?? value ?? "");
export const ebayArray = (value: any): any[] => value == null ? [] : Array.isArray(value) ? value : [value];
const tag = (name: string, value: unknown) => `<${name}>${xmlText(value)}</${name}>`;
export const ungradedConditions: Record<string, string> = {
  "400010": "Near Mint or Better", "400011": "Excellent", "400012": "Very Good", "400013": "Poor",
};
export const cardSignature = (product: any) => createHash("sha256").update(JSON.stringify(
  [product.id, product.sku, product.player, product.club, product.number, product.variant,
    product.collection, product.season, product.condition, product.photo, product.price],
)).digest("hex");
function string(value: unknown, name: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    throw new Error(`Enter a valid ${name} (maximum ${max} characters).`);
  return value.trim();
}
export function websitePhoto(photo: string) {
  if (photo?.startsWith("/storage/cards/")) {
    try { return new URL(photo, process.env.SHOP_URL).href; } catch { return ""; }
  }
  return photo || "";
}
export function listingDefaults(product: any) {
  return {
    title: `${product.player} #${product.number} ${product.variant} ${product.collection} ${product.season}`.slice(0, 80),
    price: product.price / 100, quantity: Math.min(1, product.available), photos: websitePhoto(product.photo),
    description: `${product.player} #${product.number}\n${product.collection} ${product.season}\n${product.variant} · ${product.condition}\nOne single card per unit.`,
    condition: ({ "Near mint": "400010", Excellent: "400011", "Very good": "400012", Poor: "400013" } as Record<string, string>)[product.condition] || "",
    specifics: [{ name: "Sport", value: "Football" }, { name: "Type", value: "Sports Trading Card" },
      { name: "Player/Athlete", value: product.player }, { name: "Team", value: product.club },
      { name: "Season", value: product.season }, { name: "Set", value: product.collection },
      { name: "Card Number", value: product.number }, { name: "Parallel/Variety", value: product.variant },
      { name: "Graded", value: "No" },
      ...(/topps/i.test(product.collection) ? [{ name: "Manufacturer", value: "Topps" }] : [])],
  };
}
export function listingInput(product: any, body: any) {
  const quantity = Number(body.quantity), price = body.price;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > product.available)
    throw new Error("Choose a quantity within current website availability, excluding checkout holds.");
  if (!Number.isSafeInteger(price) || price < 50 || price > 1_000_000)
    throw new Error("Choose an eBay price between £0.50 and £10,000 per card.");
  if (!ungradedConditions[body.condition]) throw new Error("Choose the eBay condition of this ungraded card.");
  const photos = string(body.photos, "photo URLs", 24_000).split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
  if (photos.length < 1 || photos.length > 12) throw new Error("Provide between 1 and 12 real card photo URLs, one per line.");
  for (const photo of photos) {
    let parsed: URL;
    try { parsed = new URL(photo); } catch { throw new Error("Use publicly accessible HTTPS card photo URLs."); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || photo.length > 2000)
      throw new Error("Use publicly accessible HTTPS card photo URLs.");
  }
  if (!Array.isArray(body.specifics) || body.specifics.length < 1 || body.specifics.length > 30)
    throw new Error("Enter the card item specifics (up to 30).");
  const specifics = body.specifics.map((pair: any) => ({ name: string(pair.name, "specific name", 65), value: string(pair.value, "specific value", 65) }));
  if (new Set(specifics.map((pair: any) => pair.name.toLowerCase())).size !== specifics.length)
    throw new Error("Each item specific name must be unique.");
  const graded = specifics.find((pair: any) => pair.name.toLowerCase() === "graded");
  if (!graded || graded.value.toLowerCase() !== "no") throw new Error("This action supports ungraded single cards only; set Graded to No.");
  return { title: string(body.title, "eBay title", 80), description: string(body.description, "description", 5000),
    price, quantity, condition: String(body.condition), photos, specifics, sku: product.sku };
}
export function sellingTemplate(item: any, seller: string) {
  if (!item || ebayText(item.Seller?.UserID).toLowerCase() !== seller.toLowerCase() || item.Variations ||
    ebayText(item.ListingType) !== "FixedPriceItem" ||
    ebayText(item.Country) !== "GB" || ebayText(item.Currency) !== "GBP" ||
    (item.Site && ebayText(item.Site) !== "UK") || ebayText(item.SellingStatus?.ListingStatus) !== "Active")
    throw new Error("Choose your own active UK fixed-price listing as the selling-policy template.");
  if (item.ShippingServiceCostOverrideList)
    throw new Error("Choose a template without per-listing postage cost overrides, so its policy can be reused exactly.");
  const profiles = item.SellerProfiles;
  const policies = profiles ? {
    payment: { id: ebayText(profiles.SellerPaymentProfile?.PaymentProfileID), name: ebayText(profiles.SellerPaymentProfile?.PaymentProfileName) },
    shipping: { id: ebayText(profiles.SellerShippingProfile?.ShippingProfileID), name: ebayText(profiles.SellerShippingProfile?.ShippingProfileName) },
    returns: { id: ebayText(profiles.SellerReturnProfile?.ReturnProfileID), name: ebayText(profiles.SellerReturnProfile?.ReturnProfileName) },
  } : null;
  if (policies && (!/^\d+$/.test(policies.shipping.id) || !/^\d+$/.test(policies.returns.id) ||
    (policies.payment.id && !/^\d+$/.test(policies.payment.id))))
    throw new Error("The template needs valid postage and returns business policies.");
  const cost = (value: any) => {
    const result = Number(ebayText(value) || 0);
    if (!Number.isFinite(result) || result < 0 || result > 10_000) throw new Error("Template postage cost needs review.");
    return Math.round(result * 100);
  };
  const services = ebayArray(item.ShippingDetails?.ShippingServiceOptions).map((service) => ({
    name: ebayText(service.ShippingService), cost: cost(service.ShippingServiceCost),
    additional: cost(service.ShippingServiceAdditionalCost), free: ebayText(service.FreeShipping) === "true",
  }));
  if (!policies && (ebayText(item.ShippingDetails?.ShippingType) !== "Flat" || !services.length ||
    ebayArray(item.ShippingDetails?.InternationalShippingServiceOption).length))
    throw new Error("Without business policies, choose a UK-only flat-postage template.");
  const returns = { accepted: ebayText(item.ReturnPolicy?.ReturnsAcceptedOption),
    within: ebayText(item.ReturnPolicy?.ReturnsWithinOption), payer: ebayText(item.ReturnPolicy?.ShippingCostPaidByOption),
    refund: ebayText(item.ReturnPolicy?.RefundOption) };
  if (!policies && !["ReturnsAccepted", "ReturnsNotAccepted"].includes(returns.accepted))
    throw new Error("The template needs a valid returns policy.");
  const dispatchDays = Number(item.DispatchTimeMax);
  if (!Number.isSafeInteger(dispatchDays) || dispatchDays < 0 || dispatchDays > 30)
    throw new Error("The template needs a valid dispatch time.");
  return { policies, services, returns, dispatchDays, autoPay: ebayText(item.AutoPay) === "true",
    location: item.Location ? string(ebayText(item.Location), "dispatch location", 80) : "",
    postalCode: item.PostalCode ? string(ebayText(item.PostalCode), "dispatch postcode", 20) : "" };
}
export type ListingInput = ReturnType<typeof listingInput>;
export type SellingTemplate = ReturnType<typeof sellingTemplate>;
export function dispatchOverrides(template: SellingTemplate, body: any): SellingTemplate {
  return { ...template,
    location: string(typeof body.location === "string" && body.location.trim() ? body.location : template.location, "dispatch location", 80),
    postalCode: string(typeof body.postalCode === "string" && body.postalCode.trim() ? body.postalCode : template.postalCode, "dispatch postcode", 20) };
}
export function buildListingXml(input: ListingInput, template: SellingTemplate, uuid?: string) {
  const policyXml = template.policies
    ? `<SellerProfiles>${template.policies.payment.id ? `<SellerPaymentProfile>${tag("PaymentProfileID", template.policies.payment.id)}</SellerPaymentProfile>` : ""}<SellerShippingProfile>${tag("ShippingProfileID", template.policies.shipping.id)}</SellerShippingProfile><SellerReturnProfile>${tag("ReturnProfileID", template.policies.returns.id)}</SellerReturnProfile></SellerProfiles>`
    : `<ShippingDetails><ShippingType>Flat</ShippingType>${template.services.map((service, index) =>
      `<ShippingServiceOptions>${tag("ShippingServicePriority", index + 1)}${tag("ShippingService", service.name)}${tag("ShippingServiceCost", (service.cost / 100).toFixed(2))}${tag("ShippingServiceAdditionalCost", (service.additional / 100).toFixed(2))}${tag("FreeShipping", service.free)}</ShippingServiceOptions>`).join("")}</ShippingDetails><ShipToLocations>GB</ShipToLocations><ReturnPolicy>${tag("ReturnsAcceptedOption", template.returns.accepted)}${template.returns.within ? tag("ReturnsWithinOption", template.returns.within) : ""}${template.returns.payer ? tag("ShippingCostPaidByOption", template.returns.payer) : ""}${template.returns.refund ? tag("RefundOption", template.returns.refund) : ""}</ReturnPolicy>`;
  const description = input.description.split(/\r?\n/).map((line) => `<p>${xmlText(line)}</p>`).join("");
  return `<Item>${uuid ? tag("UUID", uuid) : ""}${tag("Title", input.title)}${tag("Description", description)}
    <PrimaryCategory><CategoryID>261328</CategoryID></PrimaryCategory><ConditionID>4000</ConditionID>
    <ConditionDescriptors><ConditionDescriptor><Name>40001</Name>${tag("Value", input.condition)}</ConditionDescriptor></ConditionDescriptors>
    <ListingType>FixedPriceItem</ListingType><ListingDuration>GTC</ListingDuration><Currency>GBP</Currency><Country>GB</Country><Site>UK</Site>
    ${tag("SKU", input.sku)}<InventoryTrackingMethod>SKU</InventoryTrackingMethod>${tag("Quantity", input.quantity)}${tag("StartPrice", (input.price / 100).toFixed(2))}
    ${tag("Location", template.location)}${tag("PostalCode", template.postalCode)}${tag("DispatchTimeMax", template.dispatchDays)}${tag("AutoPay", template.autoPay)}
    <PictureDetails>${input.photos.map((photo) => tag("PictureURL", photo)).join("")}</PictureDetails>
    <ItemSpecifics>${input.specifics.map((pair: any) => `<NameValueList>${tag("Name", pair.name)}${tag("Value", pair.value)}</NameValueList>`).join("")}</ItemSpecifics>${policyXml}</Item>`;
}
export function verificationSummary(response: any) {
  const fees = ebayArray(response.Fees?.Fee).map((fee) => ({ name: ebayText(fee.Name),
    pence: Math.round(Number(ebayText(fee.Fee)) * 100), currency: fee.Fee?.["@_currencyID"] || "GBP" }));
  if (!fees.length || fees.some((fee) => !fee.name || !Number.isSafeInteger(fee.pence) || !/^[A-Z]{3}$/.test(fee.currency)))
    throw new Error("eBay did not return a valid listing-fee estimate. Create another preview before publishing.");
  return {
    fees: fees.sort((a, b) => a.name.localeCompare(b.name)),
    warnings: ebayArray(response.Errors).map((error) => `${ebayText(error.ErrorCode)}: ${ebayText(error.LongMessage || error.ShortMessage)}`.slice(0, 600)).sort(),
  };
}
