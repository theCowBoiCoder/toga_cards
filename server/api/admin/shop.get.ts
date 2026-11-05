import { getInventory } from "../../utils/inventory";
export default defineEventHandler(() => ({
  stockSync: getInventory().stockSync.status(),
  products: getInventory().shop.products(),
  listings: getInventory().shop.listings(),
  orders: getInventory().shop.orders(),
}));
