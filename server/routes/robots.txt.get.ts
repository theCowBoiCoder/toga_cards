import { SITE_URL } from "#shared/seo";
export default defineEventHandler(event => {
  setHeader(event, "Content-Type", "text/plain; charset=utf-8");
  if (process.env.TOGA_PREVIEW === "1") return "User-agent: *\nDisallow: /\n";
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /account
Disallow: /api/
Disallow: /shop?*checkout=
Sitemap: ${SITE_URL}/sitemap.xml
`;
});
