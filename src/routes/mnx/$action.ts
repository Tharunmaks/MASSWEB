import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";

/**
 * The Mnx Index (pages crawled by the Mnx Spiders), answered in plain text for AI agents.
 *   /mnx/search?q=...&n=10&page=1&days=7&site=example.com   (&format=json)
 *   /mnx/images?q=...
 *   /mnx/page?url=...
 *   /mnx/stats
 */

function reply(body: string | object, status = 200, cache = "public, max-age=0, s-maxage=300, stale-while-revalidate=1800"): Response {
  const json = typeof body !== "string";
  return new Response(json ? JSON.stringify(body) : body, {
    status,
    headers: { "content-type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": cache, ...CORS_HEADERS },
  });
}

function int(value: string | null, low: number, high: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== null && value !== "" ? Math.max(low, Math.min(high, Math.trunc(n))) : fallback;
}

export const Route = createFileRoute("/mnx/$action")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const asJson = url.searchParams.get("format") === "json";
        const mnx = await import("@/lib/browser/mnxindex.server");
        await mnx.ready(8000);
        const loading = mnx.stats().loading;
        // Don't let caches keep an answer from a half-loaded index.
        const cache = loading ? "no-store" : undefined;

        if (params.action === "search") {
          const q = (url.searchParams.get("q") || "").trim();
          if (!q) return reply(asJson ? { error: "Add ?q=your+search" } : "Add ?q=your+search\n", 400);
          const n = int(url.searchParams.get("n"), 1, 50, 10);
          const page = int(url.searchParams.get("page"), 1, 20, 1);
          const days = int(url.searchParams.get("days"), 0, 36500, 0);
          const site = (url.searchParams.get("site") || "").trim().toLowerCase();
          const found = mnx.search(q, { n, offset: (page - 1) * n, days, site });
          const filters = Object.fromEntries(Object.entries({ days, site, n: n === 10 ? 0 : n }).filter(([, v]) => v));
          if (asJson) return reply({ query: q, page, total: found.total, index: mnx.stats(), results: found.hits.map(({ score: _s, digest: _d, ...h }) => h) }, 200, cache);
          return reply(mnx.searchText(q, found, page, url.origin, filters), 200, cache);
        }

        if (params.action === "images") {
          const q = (url.searchParams.get("q") || "").trim();
          const items = q ? mnx.images(q, int(url.searchParams.get("n"), 1, 60, 20)) : [];
          if (asJson) return reply({ query: q, images: items }, 200, cache);
          const lines = [`Mnx Index: ${items.length} images for "${q}"`, mnx.UNTRUSTED, ""];
          items.forEach((it, i) => lines.push(`[${i + 1}] ${it.title}`, `Image: ${it.image}`, `Page: ${it.page}${it.published ? ` | Published: ${it.published.slice(0, 10)}` : ""}`, ""));
          return reply(lines.join("\n").trimEnd() + "\n", 200, cache);
        }

        if (params.action === "page") {
          const target = (url.searchParams.get("url") || "").trim();
          const hit = target ? mnx.page(target) : null;
          if (!hit) return reply(asJson ? { error: "Not in the index." } : "Not in the index. Open it live: /api/agent/read?url=...\n", 404, "no-store");
          if (asJson) return reply({ url: hit.url, title: hit.title, published: hit.published, crawled: hit.crawled, text: hit.body });
          return reply(
            [`# ${hit.title || hit.url}`, `URL: ${hit.url}`, `Published: ${hit.published.slice(0, 10) || "not stated"} | Crawled: ${hit.crawled.slice(0, 10) || "unknown"}`, mnx.UNTRUSTED, "<<<PAGE CONTENT", hit.body, "PAGE CONTENT>>>", "(Stored text is cut short. Open the URL for the full page.)"].join("\n") + "\n",
          );
        }

        if (params.action === "stats") {
          const s = mnx.stats();
          if (asJson) return reply(s, 200, "no-store");
          return reply(`Mnx Index\nPages: ${s.pages.toLocaleString("en-US")}\nShards: ${s.shards}\nBuilt: ${s.built || "not yet"}\n${s.loading ? "Still loading shards.\n" : ""}`, 200, "no-store");
        }

        return reply(asJson ? { error: "Use /mnx/search, /mnx/images, /mnx/page or /mnx/stats" } : "Use /mnx/search, /mnx/images, /mnx/page or /mnx/stats\n", 404);
      },
    },
  },
});
