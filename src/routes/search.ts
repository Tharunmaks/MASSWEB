import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";

/** Mass Search as a web page of its own: anyone (and any browser) can use /search?q=... */
export const Route = createFileRoute("/search")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = (url.searchParams.get("q") || "").trim();
        const { searchPageFor } = await import("@/lib/browser/search-page.server");
        const html = await searchPageFor(url.searchParams, request, { dark: url.searchParams.get("dark") === "1", embedded: false });
        return new Response(html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": query ? "public, max-age=0, s-maxage=120, stale-while-revalidate=600" : "public, max-age=3600",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
