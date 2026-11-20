import { SITE_URL } from "#shared/seo";
export function useStoreSeo(input: () => { title: string; description: string; path: string; image?: string; product?: boolean; noindex?: boolean }) {
  const seo = computed(input);
  useSeoMeta({
    title: () => seo.value.title,
    description: () => seo.value.description,
    ogTitle: () => seo.value.title, ogDescription: () => seo.value.description,
    ogType: () => seo.value.product ? "product" : "website",
    ogUrl: () => SITE_URL + seo.value.path, ogSiteName: "Toga Cards", ogLocale: "en_GB",
    ogImage: () => seo.value.image ? new URL(seo.value.image, SITE_URL).href : SITE_URL + "/social-card.png",
    twitterCard: "summary_large_image", twitterTitle: () => seo.value.title,
    twitterDescription: () => seo.value.description,
    twitterImage: () => seo.value.image ? new URL(seo.value.image, SITE_URL).href : SITE_URL + "/social-card.png",
    robots: () => seo.value.noindex ? "noindex, follow" : "index, follow, max-image-preview:large",
  });
  useHead(() => ({ link: [{ rel: "canonical", href: SITE_URL + seo.value.path }] }));
}
