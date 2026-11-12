import { randomBytes } from "node:crypto";
import { requireLocalRequest } from "../../utils/ebay-security";
import { getInventory } from "../../utils/inventory";
import { connectionStatus, ruName, syncEbay } from "../../utils/ebay-service";
import { pollEbayNotifications } from "../../utils/ebay-notifications";
export default defineEventHandler(async (event) => {
  requireLocalRequest(event);
  const body = await readBody(event),
    store = getInventory().ebay;
  try {
    getInventory().stockSync.assertIdle();
    switch (body.action) {
      case "notifications":
        await pollEbayNotifications();
        break;
      case "settings":
        if (
          typeof body.ruName !== "string" ||
          !body.ruName.trim() ||
          body.ruName.length > 300
        )
          throw new Error("Enter the production RuName from eBay.");
        store.setSetting("ruName", body.ruName.trim());
        break;
      case "connect": {
        if (store.setting("accountDeleted"))
          throw new Error("This workspace seller account has been deleted.");
        if (!connectionStatus().configured || !ruName())
          throw new Error(
            "Configure credentials and the production RuName first.",
          );
        const state = randomBytes(32).toString("hex");
        store.setSetting(
          "oauthState",
          JSON.stringify({ state, expires: Date.now() + 600000 }),
        );
        setCookie(event, "ebay_oauth_state", state, {
          httpOnly: true,
          secure: getRequestProtocol(event) === "https",
          sameSite: "lax",
          maxAge: 600,
          path: "/api/ebay",
        });
        const query = new URLSearchParams({
          client_id: process.env.EBAY_CLIENT_ID!,
          redirect_uri: ruName(),
          response_type: "code",
          scope: "https://api.ebay.com/oauth/api_scope",
          state,
        });
        return {
          authorizationUrl: `https://auth.ebay.com/oauth2/authorize?${query}`,
        };
      }
      case "sync":
        await syncEbay();
        break;
      case "map":
        store.mapListing(String(body.key), Number(body.cardId));
        break;
      case "reconcile":
        store.reconcile();
        break;
      case "review":
        store.reviewOrder(String(body.key), String(body.mode), body.fees);
        break;
      case "automatic":
        if (body.enabled === true) {
          if (!store.setting("lastSync") || store.setting("lastError"))
            throw new Error(
              "Complete a successful sync before enabling automatic deductions.",
            );
          if (!store.setting("autoSince"))
            store.setSetting("autoSince", new Date().toISOString());
        } else store.setSetting("autoSince", "");
        break;
      default:
        throw new Error("Unknown eBay action.");
    }
    return connectionStatus();
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : "eBay action failed.",
    });
  }
});
