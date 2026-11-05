import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { listingKey, type EbayListing, type EbayOrder } from "./ebay-store";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true,
});
const array = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string => String(v?.["#text"] ?? v ?? "");
const quantity = (v: any) => {
  const n = Number(v);
  if (v == null || !Number.isSafeInteger(n) || n < 0)
    throw new Error("eBay returned an invalid quantity.");
  return n;
};
const specifics = (v: any) =>
  array(v?.NameValueList)
    .map((pair) => [
      text(pair.Name),
      array(pair.Value).map(text).sort().join(", "),
    ])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((pair) => pair.join(": "))
    .join(" / ");
export function decodeResponse(xml: string, call: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unexpected eBay XML document.");
  const result = parser.parse(xml)[`${call}Response`];
  if (!result || !["Success", "Warning"].includes(result.Ack))
    throw new Error(
      `eBay ${call} failed (${text(array(result?.Errors)[0]?.ErrorCode) || "invalid response"}). Reconnect or check eBay API access.`,
    );
  // Warnings may indicate a partial result: never replace local state from one.
  if (result.Ack === "Warning")
    throw new Error(
      `eBay ${call} returned a warning; the previous snapshot was retained.`,
    );
  return result;
}
export function parseListings(response: any): EbayListing[] {
  return array(response.ActiveList?.ItemArray?.Item).flatMap((item) => {
    const itemId = text(item.ItemID);
    if (!itemId) throw new Error("Missing eBay listing ID.");
    const variations = array(item.Variations?.Variation);
    return (variations.length ? variations : [item]).map((v) => {
      const sku = text(v.SKU),
        variation = variations.length ? specifics(v.VariationSpecifics) : "";
      if (variations.length && !sku && !variation)
        throw new Error("A variation has no stable identity.");
      const available =
        !variations.length && item.QuantityAvailable != null
          ? quantity(item.QuantityAvailable)
          : quantity(v.Quantity) -
            quantity(v.SellingStatus?.QuantitySold ?? "0");
      if (available < 0)
        throw new Error("eBay returned negative availability.");
      return {
        key: listingKey(itemId, sku, variation),
        itemId,
        sku,
        variation,
        title: text(item.Title),
        available,
        sold: quantity(v.SellingStatus?.QuantitySold ?? v.QuantitySold ?? "0"),
      };
    });
  });
}
export function parseOrders(response: any): EbayOrder[] {
  return array(response.OrderArray?.Order).flatMap((order) =>
    array(order.TransactionArray?.Transaction).map((t) => {
      const orderId = text(order.OrderID),
        itemId = text(t.Item?.ItemID),
        sku = text(t.Variation?.SKU || t.Item?.SKU),
        variation = specifics(t.Variation?.VariationSpecifics);
      const id =
        text(t.OrderLineItemID) ||
        (itemId && text(t.TransactionID)
          ? `${itemId}-${text(t.TransactionID)}`
          : "");
      if (!orderId || !id || !itemId)
        throw new Error("Order is missing its stable eBay reference.");
      const count = quantity(t.QuantityPurchased);
      if (!count) throw new Error("Order quantity cannot be zero.");
      const price = text(t.TransactionPrice);
      if (!/^\d+(\.\d{1,2})?$/.test(price))
        throw new Error("Unsupported order price precision.");
      const gross = Math.round(Number(price) * 100) * count;
      if (!Number.isSafeInteger(gross)) throw new Error("Invalid order price.");
      const created = text(t.CreatedDate || order.CreatedTime);
      if (!Number.isFinite(Date.parse(created)))
        throw new Error("Invalid order timestamp.");
      const cancel = text(order.CancelStatus);
      const refunded =
        Number(text(order.RefundAmount) || 0) > 0 ||
        array(order.RefundArray?.Refund).length > 0 ||
        !!t.RefundArray;
      return {
        key: createHash("sha256").update(`${orderId}:${id}`).digest("hex"),
        orderId,
        itemId,
        sku,
        variation,
        title: text(t.Item?.Title),
        quantity: count,
        gross,
        currency: text(t.TransactionPrice?.["@_currencyID"]),
        created: new Date(created).toISOString(),
        paid:
          order.OrderStatus === "Completed" &&
          order.CheckoutStatus?.Status === "Complete" &&
          order.CheckoutStatus?.eBayPaymentStatus === "NoPaymentFailure" &&
          !!order.PaidTime,
        cancelled:
          refunded ||
          ["Cancelled", "CancelPending"].includes(order.OrderStatus) ||
          (!!cancel &&
            cancel !== "NotApplicable" &&
            cancel !== "CancelRejected" &&
            cancel !== "CancelClosedNoRefund"),
      };
    }),
  );
}

export async function tradingCall(token: string, call: string, body: string) {
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": "3",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1477",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: `<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${call}Request>`,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      `eBay returned HTTP ${response.status}. No stock changes were made by this fetch.`,
    );
  return decodeResponse(await response.text(), call);
}
export async function fetchEbaySnapshot(
  token: string,
  from: string,
  to: string,
  call = tradingCall,
) {
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new Error('Invalid eBay order date range.');
  const listings: EbayListing[] = [],
    orders: EbayOrder[] = [];
  for (let page = 1; page <= 1000; page++) {
    const response = await call(
      token,
      "GetMyeBaySelling",
      `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><HideVariations>false</HideVariations>`,
    );
    const batch = parseListings(response);
    listings.push(...batch);
    const pages = Number(
      response.ActiveList?.PaginationResult?.TotalNumberOfPages ??
        (batch.length ? NaN : 0),
    );
    if (!Number.isSafeInteger(pages) || pages > 1000)
      throw new Error("Invalid eBay listing pagination.");
    if (page >= pages) break;
  }
  // ModTime filters allow at most 30 days per request. Share boundaries
  // between windows and deduplicate stable line IDs to avoid losing orders.
  for (let windowStart = start; windowStart < end;) {
    const windowEnd = Math.min(end, windowStart + 29 * 86400000);
  for (let page = 1; page <= 1000; page++) {
    const response = await call(
      token,
      "GetOrders",
      `<OrderRole>Seller</OrderRole><OrderStatus>All</OrderStatus><ModTimeFrom>${new Date(windowStart).toISOString()}</ModTimeFrom><ModTimeTo>${new Date(windowEnd).toISOString()}</ModTimeTo><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>`,
    );
    orders.push(...parseOrders(response));
    if (response.HasMoreOrders === "false" || response.HasMoreOrders === false)
      break;
    if (response.HasMoreOrders !== "true" && response.HasMoreOrders !== true)
      throw new Error("Missing eBay order pagination status.");
    if (page === 1000) throw new Error("eBay order pagination limit reached.");
  }
    windowStart = windowEnd;
  }
  return { listings, orders: [...new Map(orders.map(order => [order.key, order])).values()] };
}
