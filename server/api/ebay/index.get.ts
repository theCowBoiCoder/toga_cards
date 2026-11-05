import { connectionStatus } from "../../utils/ebay-service";
export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  return connectionStatus();
});
