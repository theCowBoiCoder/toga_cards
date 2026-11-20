import { getInventory } from "../../../utils/inventory";
export default defineEventHandler(event => {
  setHeader(event, "Cache-Control", "no-store");
  const raw = getRouterParam(event, "id") || "";
  if (!/^[1-9]\d*$/.test(raw)) throw createError({ statusCode: 404, statusMessage: "Card not found" });
  // A published listing stays reachable when sold out; unpublished checklist entries do not.
  const card = getInventory().shop.products().find(card => card.id === Number(raw) && card.price);
  if (!card) throw createError({ statusCode: 404, statusMessage: "Card not found" });
  return card;
});
