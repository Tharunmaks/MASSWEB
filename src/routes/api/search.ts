import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";

/** Mass Search results as JSON: GET /api/search?q=...&p=1 */
export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = (url.searchParams.get("q") || "").trim();
        if (!query) return new Response(JSON.stringify({ error: "Add ?q=your+search" }), { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } });
        const { massSearch } = await import("@/lib/browser/masssearch.server");
        const data = await massSearch(query, request, Number(url.searchParams.get("p") || "1") || 1);
        return new Response(JSON.stringify(data), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
