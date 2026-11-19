import { getInventory } from "./inventory";
import { accessToken, syncEbay } from "./ebay-service";
import { fetchActiveListings, tradingCall } from "./ebay-client";
import { listingKey, type EbayListing } from "./ebay-store";
import { buildListingXml, cardSignature, dispatchOverrides, ebayArray, ebayText, listingDefaults, listingInput,
  sellingTemplate, verificationSummary, xmlText } from "./ebay-listing-payload";

type Inventory = ReturnType<typeof getInventory>;
export type PublishingDependencies = {
  inventory: Inventory;
  call: (name: string, body: string) => Promise<any>;
  activeListings: () => Promise<EbayListing[]>;
  syncOrders: (owner: string) => Promise<void>;
};
export function ebayPublishingContext(inv = getInventory()) {
  const published = new Set((inv.shop.listings() as any[]).map((listing) => listing.card_id));
  return {
    connected: !!inv.ebay.setting("tokens") && !inv.ebay.setting("accountDeleted"),
    products: inv.shop.products().filter((product) => published.has(product.id) && product.available > 0)
      .map((product) => ({ ...product, defaults: listingDefaults(product) })),
    templates: inv.ebay.snapshot().listings.filter((listing) => listing.active && !listing.variation)
      .map((listing) => ({ id: listing.itemId, title: listing.title })),
    drafts: inv.ebayPublishing.latest(),
  };
}
export function createEbayPublisher(deps: PublishingDependencies) {
  const inv = deps.inventory;
  function assertConnected(seller?: string) {
    if (process.env.TOGA_PREVIEW === "1") throw new Error("Publishing is disabled in the demonstration shop.");
    if (!inv.ebay.setting("tokens") || !inv.ebay.setting("seller") || inv.ebay.setting("accountDeleted"))
      throw new Error("Connect your eBay seller account first.");
    if (seller && inv.ebay.setting("seller") !== seller) throw new Error("The connected seller changed. Create a new preview.");
  }
  function productFor(id: number) {
    const product = inv.shop.products().find((product) => product.id === id);
    if (!product || !(inv.shop.listings() as any[]).some((listing) => listing.card_id === id) || !product.sku || !product.price)
      throw new Error("List this single on your website and assign its SKU first.");
    if (product.condition === "Not assessed") throw new Error("Assess this card's condition before listing it.");
    return product;
  }
  function assertNoDuplicate(cardId: number, sku: string, active: EbayListing[]) {
    const mappedIds = new Set(inv.ebay.snapshot().listings.filter((listing) => listing.cardId === cardId).map((listing) => listing.itemId));
    if (active.some((listing) => listing.sku.toUpperCase() === sku.toUpperCase() || mappedIds.has(listing.itemId)))
      throw new Error("This SKU or matched card already has an active eBay listing. Import/match it and use Update eBay stock instead.");
  }
  async function assertPreviousListingEnded(cardId: number) {
    const previous = inv.ebayPublishing.lastPublished(cardId);
    if (!previous) return;
    const item = (await deps.call("GetItem", `<ItemID>${xmlText(previous.item_id)}</ItemID>`)).Item;
    if (ebayText(item?.ItemID) !== previous.item_id ||
      !["Completed", "Ended"].includes(ebayText(item?.SellingStatus?.ListingStatus)))
      throw new Error("The previous eBay listing has not been confirmed ended. Update or check that listing instead.");
  }
  function result(id: string) {
    const draft = inv.ebayPublishing.get(id);
    if (!draft) throw new Error("Publication preview not found.");
    return { draftId: id, cardId: draft.card_id, status: draft.status, itemId: draft.item_id,
      url: draft.item_id ? `https://www.ebay.co.uk/itm/${draft.item_id}` : null,
      preview: JSON.parse(draft.payload), expiresAt: new Date(draft.created + 15 * 60_000).toISOString(), issue: draft.issue };
  }
  async function preview(body: any) {
    assertConnected();
    inv.stockSync.assertIdle();
    const product = productFor(Number(body.cardId));
    inv.ebayPublishing.assertNoUncertain(product.id);
    const input = listingInput(product, body);
    const templateId = String(body.templateId || "");
    if (!/^\d{6,20}$/.test(templateId) || !inv.ebay.snapshot().listings.some((listing) => listing.active && listing.itemId === templateId && !listing.variation))
      throw new Error("Choose an imported active eBay single as the policy template. Import eBay first if needed.");
    const seller = inv.ebay.setting("seller");
    await assertPreviousListingEnded(product.id);
    assertNoDuplicate(product.id, product.sku, await deps.activeListings());
    const templateItem = (await deps.call("GetItem", `<ItemID>${templateId}</ItemID><DetailLevel>ReturnAll</DetailLevel>`)).Item;
    if (ebayText(templateItem?.ItemID) !== templateId) throw new Error("eBay returned another policy template.");
    const sourceTemplate = sellingTemplate(templateItem, seller);
    const template = dispatchOverrides(sourceTemplate, body);
    const verification = verificationSummary(await deps.call("VerifyAddFixedPriceItem", buildListingXml(input, template)));
    assertConnected(seller);
    const current = productFor(product.id);
    if (cardSignature(current) !== cardSignature(product) || current.available < input.quantity)
      throw new Error("The card or its stock changed during validation. Refresh and create another preview.");
    const draft = inv.ebayPublishing.save(product.id, product.sku, seller, {
      input, template, sourceTemplate, templateId, templateTitle: ebayText(templateItem.Title),
      signature: cardSignature(product), verification,
    });
    return result(draft.id);
  }
  async function readPublished(draft: any, itemId?: string) {
    const lookup = itemId ? `<ItemID>${xmlText(itemId)}</ItemID>`
      : `<SKU>${xmlText(draft.sku)}</SKU><InventoryTrackingMethod>SKU</InventoryTrackingMethod>`;
    const item = (await deps.call("GetItem", `${lookup}<DetailLevel>ReturnAll</DetailLevel>`)).Item;
    const payload = JSON.parse(draft.payload);
    const sold = Number(item?.SellingStatus?.QuantitySold || 0);
    const quantity = Number(item?.Quantity);
    const returnedId = ebayText(item?.ItemID);
    const returnedPrice = Math.round(Number(ebayText(item?.StartPrice)) * 100);
    const descriptor = ebayArray(item?.ConditionDescriptors?.ConditionDescriptor).find((descriptor) => ebayText(descriptor.Name) === "40001");
    if (!/^\d{6,20}$/.test(returnedId) || (itemId && returnedId !== itemId) || ebayText(item?.SKU) !== draft.sku ||
      ebayText(item?.Seller?.UserID).toLowerCase() !== draft.seller.toLowerCase() || item.Variations ||
      ebayText(item?.ListingType) !== "FixedPriceItem" || ebayText(item?.PrimaryCategory?.CategoryID) !== "261328" ||
      ebayText(item?.ConditionID) !== "4000" || !ebayArray(descriptor?.Value).some((value) => ebayText(value) === payload.input.condition) ||
      ebayText(item?.Currency) !== "GBP" || ebayText(item?.Country) !== "GB" ||
      ebayText(item?.Title) !== payload.input.title || returnedPrice !== payload.input.price ||
      !Number.isSafeInteger(quantity) || !Number.isSafeInteger(sold) || sold < 0 || quantity < sold || quantity > payload.input.quantity)
      throw new Error("eBay listing identity or terms do not match the approved preview. Review it in Seller Hub.");
    assertConnected(draft.seller);
    inv.ebayPublishing.published(draft.id, {
      key: listingKey(returnedId, draft.sku), itemId: returnedId, sku: draft.sku,
      title: ebayText(item.Title), available: quantity - sold, sold, variation: "",
    });
    return result(draft.id);
  }
  async function check(id: string) {
    assertConnected();
    const draft = inv.ebayPublishing.get(id);
    if (!draft || !["publishing", "unknown", "published"].includes(draft.status)) throw new Error("Choose a submitted publication to check.");
    assertConnected(draft.seller);
    if (draft.status === "published") return result(id);
    try { return await readPublished(draft, draft.item_id); }
    catch { return { ...result(id), issue: "Publication is not confirmed yet. Check Seller Hub before making another listing. No new publish request was sent." }; }
  }
  async function publish(id: string, confirmed: boolean) {
    if (confirmed !== true) throw new Error("Review the preview and explicitly confirm publication first.");
    assertConnected();
    const existing = inv.ebayPublishing.get(id);
    if (existing?.status === "published") return result(id);
    inv.stockSync.assertIdle();
    const owner = inv.stockSync.acquire();
    if (!owner) throw new Error("A stock update is running. Try again shortly.");
    const heartbeat = setInterval(() => { try { inv.stockSync.renew(owner); } catch {} }, 30_000);
    heartbeat.unref();
    let claimed = false;
    let submitted = false;
    try {
      const draft = inv.ebayPublishing.claim(id);
      claimed = true;
      assertConnected(draft.seller);
      const payload = JSON.parse(draft.payload);
      await deps.syncOrders(owner);
      inv.stockSync.assertOwner(owner);
      if (inv.ebay.setting("lastError") || inv.ebay.setting("notificationError")) throw new Error("Resolve the eBay import errors before publishing.");
      const product = productFor(draft.card_id);
      await assertPreviousListingEnded(draft.card_id);
      if (cardSignature(product) !== payload.signature || product.available < payload.input.quantity)
        throw new Error("Card details or available stock changed. Create a fresh preview.");
      assertNoDuplicate(draft.card_id, draft.sku, inv.ebay.snapshot().listings.filter((listing) => listing.active));
      const templateItem = (await deps.call("GetItem", `<ItemID>${payload.templateId}</ItemID><DetailLevel>ReturnAll</DetailLevel>`)).Item;
      if (JSON.stringify(sellingTemplate(templateItem, draft.seller)) !== JSON.stringify(payload.sourceTemplate))
        throw new Error("The template's selling policies changed. Create a new preview.");
      const xml = buildListingXml(payload.input, payload.template, id);
      const currentVerification = verificationSummary(await deps.call("VerifyAddFixedPriceItem", xml));
      if (JSON.stringify(currentVerification) !== JSON.stringify(payload.verification))
        throw new Error("eBay fees or warnings changed. Create a new preview to review them.");
      inv.stockSync.assertOwner(owner);
      assertConnected(draft.seller);
      submitted = true;
      const response = await deps.call("AddFixedPriceItem", xml);
      const itemId = ebayText(response.ItemID);
      if (!/^\d{6,20}$/.test(itemId)) throw new Error("eBay did not confirm a listing ID.");
      inv.ebayPublishing.unknown(id, itemId);
      return await readPublished(draft, itemId);
    } catch (error) {
      if (submitted) {
        const detail = error instanceof Error && error.message.startsWith("eBay AddFixedPriceItem failed:")
          ? ` ${error.message.slice(0, 1200)}` : "";
        inv.ebayPublishing.unknown(id, undefined, `eBay publication could not be confirmed. Use Check publication; do not submit another listing.${detail}`);
        return result(id);
      }
      if (claimed) inv.ebayPublishing.reset(id);
      throw error;
    } finally {
      clearInterval(heartbeat);
      inv.stockSync.release(owner);
    }
  }
  return { preview, publish, check, load: result };
}
export function ebayPublisher() {
  return createEbayPublisher({ inventory: getInventory(),
    call: async (name, body) => tradingCall(await accessToken(), name, body,
      name === "VerifyAddFixedPriceItem" || name === "AddFixedPriceItem"),
    activeListings: async () => fetchActiveListings(await accessToken()), syncOrders: syncEbay,
  });
}
