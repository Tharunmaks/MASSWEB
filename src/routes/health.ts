import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";

/** Lets the GitHub Pages app check that an address is a Mass Web server. */
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ app: "mass-web", ok: true, version: 1 }), {
          headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
        }),
      OPTIONS: () => preflight(),
    },
  },
});
