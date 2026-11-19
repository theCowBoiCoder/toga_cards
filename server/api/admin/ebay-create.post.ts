import { ebayPublisher } from "../../utils/ebay-publishing-service";
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const service = ebayPublisher();
  try {
    switch (body?.action) {
      case "preview": return await service.preview(body);
      case "publish": return await service.publish(String(body.draftId || ""), body.confirmed);
      case "check": return await service.check(String(body.draftId || ""));
      case "load": return service.load(String(body.draftId || ""));
      default: throw new Error("Choose a listing preview or publication action.");
    }
  } catch (error) {
    throw createError({ statusCode: 409, statusMessage: error instanceof Error ? error.message : "eBay listing action could not be confirmed." });
  }
});
