import { timingSafeEqual } from "node:crypto";
import { getInventory } from "../../utils/inventory";
import { exchangeCode } from "../../utils/ebay-service";
export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Referrer-Policy", "no-referrer");
  const query = getQuery(event),
    store = getInventory().ebay;
  const saved = JSON.parse(store.setting("oauthState") || "{}");
  const state = String(query.state || ""),
    cookie = getCookie(event, "ebay_oauth_state");
  const valid =
    state.length === 64 &&
    saved.state?.length === 64 &&
    timingSafeEqual(Buffer.from(state), Buffer.from(saved.state)) &&
    cookie === state &&
    saved.expires > Date.now();
  if (!valid)
    throw createError({
      statusCode: 400,
      statusMessage:
        "eBay connection expired or state did not match. Start again from the app.",
    });
  store.setSetting("oauthState", "");
  deleteCookie(event, "ebay_oauth_state", { path: "/api/ebay" });
  if (query.error || typeof query.code !== "string")
    return sendRedirect(event, "/admin?ebay=denied");
  try {
    await exchangeCode(query.code);
    return sendRedirect(event, "/admin?ebay=connected");
  } catch {
    return sendRedirect(event, "/admin?ebay=connection-failed");
  }
});
