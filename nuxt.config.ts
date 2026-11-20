import tailwindcss from "@tailwindcss/vite";
export default defineNuxtConfig({
  compatibilityDate: "2026-09-08",
  modules: ["shadcn-nuxt"],
  css: ["~/assets/main.css"],
  vite: { plugins: [tailwindcss()] },
  shadcn: { prefix: "", componentDir: "./app/components/ui" },
  app: {
    head: {
      title: "Football Cards UK | Topps Premier League Singles | Toga Cards",
      htmlAttrs: { lang: "en-GB" },
      link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
      meta: [
        {
          name: "description",
          content:
            "Football cards for your collection. Explore Premier League singles, inserts and set essentials.",
        },
      ],
    },
  },
});
