import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";

/** Mass Search image results: plain text by default, JSON with format=json. GET /api/images?q=...&p=1 */
export const Route = createFileRoute("/api/images")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const json = url.searchParams.get("format") === "json";
        const query = (url.searchParams.get("q") || "").trim();
        const type = json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
        if (!query) return new Response(json ? JSON.stringify({ error: "Add ?q=your+search" }) : "Add ?q=your+search\n", { status: 400, headers: { "content-type": type, ...CORS_HEADERS } });
        const { massImages, imagesAsText } = await import("@/lib/browser/masssearch.server");
        const data = await massImages(query, Number(url.searchParams.get("p") || "1") || 1);
        return new Response(json ? JSON.stringify(data) : imagesAsText(data), {
          headers: { "content-type": type, "cache-control": "public, max-age=0, s-maxage=600, stale-while-revalidate=3600", ...CORS_HEADERS },
        });
      },
    },
  },
});
