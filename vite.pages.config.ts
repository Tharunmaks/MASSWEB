import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * Static build of the Mass Web app for GitHub Pages.
 * PAGES_BASE is the repo path on github.io (e.g. /MASSWEB/), set by the Pages workflow.
 * The app talks to the page server at VITE_MW_SERVER (or the address saved in Settings).
 */
export default defineConfig({
  root: fileURLToPath(new URL("./pages", import.meta.url)),
  base: process.env.PAGES_BASE || "./",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { "import.meta.env.VITE_MW_STATIC": JSON.stringify("1") },
  build: { outDir: fileURLToPath(new URL("./dist-pages", import.meta.url)), emptyOutDir: true },
  server: { host: "0.0.0.0", port: 8090, strictPort: true },
  preview: { host: "127.0.0.1", port: 8091, strictPort: true },
  plugins: [tailwindcss(), viteReact()],
});
