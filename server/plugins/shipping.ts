import { getInventory } from "../utils/inventory";

export default defineNitroPlugin(() => {
  getInventory().shop.shipping.installRoyalMail();
});
