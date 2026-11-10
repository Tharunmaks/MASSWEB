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
        const page = Number(url.searchParams.get("p") || "1") || 1;
        const [{ massSearch }, { renderSearchPage }] = await Promise.all([import("@/lib/browser/masssearch.server"), import("@/lib/browser/search-page.server")]);
        const data = await massSearch(query, request, page);
        return new Response(renderSearchPage(data, { dark: url.searchParams.get("dark") === "1", embedded: false }), {
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
