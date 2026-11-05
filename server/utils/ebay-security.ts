import { createError, getHeader, type H3Event } from "h3";
export function requireLocalRequest(event: H3Event) {
  const host = getHeader(event, "host") || "";
  const origin = getHeader(event, "origin");
  if (!origin || new URL(origin).host !== host)
    throw createError({
      statusCode: 403,
      statusMessage: "A same-origin browser request is required.",
    });
}
