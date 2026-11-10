import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

/**
 * Full Mass Web (app + page server) for Vercel. The static GitHub Pages build of the
 * app lives in vite.pages.config.ts and talks to this server.
 */
export default defineConfig(({ command, isPreview }) => ({
  server: { host: "0.0.0.0", port: 8080, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: "vercel",
            // Serve from Mumbai: closest Vercel region to India, so pages load faster.
            vercel: { functions: { regions: ["bom1"], maxDuration: 30 } },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
