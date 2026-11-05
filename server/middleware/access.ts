import { createHash, timingSafeEqual } from "node:crypto";
export default defineEventHandler((event) => {
  let path: string;
  try {
    path = decodeURIComponent(getRequestURL(event).pathname)
      .toLowerCase()
      .replace(/\/+$/, "");
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid request path.",
    });
  }
  const admin =
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/inventory" ||
    path === "/api/export" ||
    path.startsWith("/api/ebay") ||
    path.startsWith("/api/admin/");
  if (!admin) return;
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "X-Robots-Tag", "noindex, nofollow");
  const password = process.env.ADMIN_PASSWORD;
  const local =
    (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      event.node.req.socket.remoteAddress || "",
    ) ||
      (import.meta.dev && !event.node.req.socket.remoteAddress)) &&
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(getHeader(event, "host") || "");
  if (!password && !local)
    throw createError({
      statusCode: 503,
      statusMessage: "Configure admin credentials before hosting.",
    });
  if (password) {
    const expected = `Basic ${Buffer.from(`${process.env.ADMIN_USER || "admin"}:${password}`).toString("base64")}`;
    const digest = (s: string) => createHash("sha256").update(s).digest();
    if (
      !timingSafeEqual(
        digest(getHeader(event, "authorization") || ""),
        digest(expected),
      )
    ) {
      setHeader(
        event,
        "WWW-Authenticate",
        'Basic realm="Toga Cards admin", charset="UTF-8"',
      );
      throw createError({
        statusCode: 401,
        statusMessage: "Admin sign-in required.",
      });
    }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(event.method)) {
    const origin = getHeader(event, "origin");
    if (!origin || origin !== getRequestURL(event).origin)
      throw createError({
        statusCode: 403,
        statusMessage: "Same-origin request required.",
      });
  }
});
