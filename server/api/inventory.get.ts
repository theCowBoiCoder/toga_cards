import { getInventory } from "../utils/inventory";
export default defineEventHandler(() => getInventory().snapshot());
