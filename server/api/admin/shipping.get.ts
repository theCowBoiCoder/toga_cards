import { getInventory } from "../../utils/inventory";
export default defineEventHandler(() => ({
  options: getInventory().shop.shipping.all(),
}));
