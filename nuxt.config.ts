import tailwindcss from "@tailwindcss/vite";
export default defineNuxtConfig({
  compatibilityDate: "2026-09-08",
  modules: ["shadcn-nuxt"],
  css: ["~/assets/main.css"],
  vite: { plugins: [tailwindcss()] },
  shadcn: { prefix: "", componentDir: "./app/components/ui" },
  app: {
    head: {
      title: "TOGA Cards — Find your next favourite",
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
