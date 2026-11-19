import { getInventory } from "../../utils/inventory";
import { emailConfiguration } from "../../utils/email-service";

export default defineEventHandler(() => {
  const configuration = emailConfiguration();
  return { ready: configuration.ready, message: configuration.reason,
    emails: getInventory().shop.emails.history() };
});
