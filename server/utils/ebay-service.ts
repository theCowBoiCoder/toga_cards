import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { getInventory } from "./inventory";
import { fetchEbaySnapshot, tradingCall } from "./ebay-client";
import { pollEbayNotifications } from "./ebay-notifications";

export function seal(value: string) {
  const key = Buffer.from(process.env.EBAY_TOKEN_KEY || "", "hex");
  if (key.length !== 32)
    throw new Error("Configure the eBay token encryption key first.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function unseal(value: string) {
  const raw = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.EBAY_TOKEN_KEY || "", "hex"),
    raw.subarray(0, 12),
  );
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
const store = () => getInventory().ebay;
export const ruName = () =>
  store().setting("ruName") || process.env.EBAY_REDIRECT_URI || "";
export function connectionStatus() {
  return {
    ...store().snapshot(),
    configured: !!(
      process.env.EBAY_CLIENT_ID &&
      process.env.EBAY_CLIENT_SECRET &&
      process.env.EBAY_TOKEN_KEY
    ),
    redirectConfigured: !!ruName(),
    connected: !!store().setting("tokens"),
    syncing: !!syncing,
    notificationLastCheck: store().setting("notificationLastCheck"),
    notificationError: store().setting("notificationError"),
    notificationOldest: store().setting("notificationOldest"),
    accountDeleted: !!store().setting("accountDeleted"),
  };
}
async function tokenRequest(parameters: Record<string, string>) {
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(parameters),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(
      `eBay authorisation failed (HTTP ${response.status}). Check credentials, RuName and seller consent.`,
    );
  const result = await response.json();
  if (!result.access_token || !result.expires_in)
    throw new Error("eBay did not return a valid access token.");
  return result;
}
async function saveTokens(tokens: any) {
  if (store().setting("accountDeleted"))
    throw new Error("This workspace seller account has been deleted.");
  const identity = await tradingCall(tokens.access_token, "GetUser", "");
  if (store().setting("accountDeleted"))
    throw new Error("This workspace seller account has been deleted.");
  const seller = String(identity.User?.UserID || "");
  if (!seller) throw new Error("Could not verify the seller account.");
  const eias = String(identity.User?.EIASToken || "");
  if (!eias)
    throw new Error("Could not verify the seller deletion identifier.");
  const previous = store().setting("seller");
  if (previous && previous !== seller)
    throw new Error(
      "This workspace is linked to a different eBay seller. Account switching requires a reviewed migration.",
    );
  store().setSetting("seller", seller);
  store().setSetting("sellerEias", eias);
  store().setSetting(
    "tokens",
    seal(
      JSON.stringify({
        ...tokens,
        expiresAt: Date.now() + Number(tokens.expires_in) * 1000,
      }),
    ),
  );
}
export async function exchangeCode(code: string) {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: ruName(),
  });
  await saveTokens(tokens);
  await pollEbayNotifications();
}
let refreshing: Promise<string> | undefined;
export async function accessToken() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const encrypted = store().setting("tokens");
    if (!encrypted) throw new Error("Connect your eBay seller account first.");
    const tokens = JSON.parse(unseal(encrypted));
    if (tokens.expiresAt > Date.now() + 120000) return tokens.access_token;
    if (!tokens.refresh_token)
      throw new Error("eBay access expired. Reconnect your seller account.");
    const refreshed = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      scope: "https://api.ebay.com/oauth/api_scope",
    });
    if (store().setting("accountDeleted"))
      throw new Error("This workspace seller account has been deleted.");
    store().setSetting(
      "tokens",
      seal(
        JSON.stringify({
          ...tokens,
          ...refreshed,
          expiresAt: Date.now() + Number(refreshed.expires_in) * 1000,
        }),
      ),
    );
    return refreshed.access_token;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = undefined;
  }
}
let syncing: Promise<void> | undefined;
export async function syncEbay(owner?: string) {
  if (owner) getInventory().stockSync.assertOwner(owner);
  else getInventory().stockSync.assertIdle();
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      await pollEbayNotifications();
      if (store().setting("accountDeleted"))
        throw new Error("This workspace seller account has been deleted.");
      const last = store().setting("lastSync"),
        now = new Date();
      const oldest = now.getTime() - 89 * 24 * 60 * 60 * 1000;
      if (last && Date.parse(last) < oldest)
        throw new Error(
          "Sync gap exceeds eBay order history. Review missing history before resuming.",
        );
      const from = new Date(
        last
          ? Math.max(oldest, Date.parse(last) - 24 * 60 * 60 * 1000)
          : oldest,
      ).toISOString();
      const token = await accessToken();
      const snapshot = await fetchEbaySnapshot(token, from, now.toISOString());
      await pollEbayNotifications();
      store().ingest(snapshot.listings, snapshot.orders, now.toISOString());
    } catch (error) {
      // Do not store raw fetch errors, which may contain URLs or request credentials.
      const message =
        error instanceof Error &&
        /^(eBay |Invalid eBay|Missing eBay|Order |Unsupported order|A variation|Connect |Sync gap|Could not verify|This workspace)/.test(
          error.message,
        )
          ? error.message
          : "eBay sync failed. Existing stock and the previous snapshot were retained. Reconnect or retry later.";
      store().setSetting("lastError", message);
      throw new Error(message);
    }
  })();
  try {
    await syncing;
  } finally {
    syncing = undefined;
  }
}
