import { getInventory } from "../utils/inventory";
export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  getInventory().health();
  return { ok: true, revision: process.env.APP_REVISION || "local" };
});
