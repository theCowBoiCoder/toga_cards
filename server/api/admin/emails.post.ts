import { getInventory } from "../../utils/inventory";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  try {
    getInventory().shop.emails.retry(String(body?.id || ""));
    return { saved: true };
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Only failed emails can be retried." });
  }
});
