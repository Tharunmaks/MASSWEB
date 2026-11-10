import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";

const UA = "Mozilla/5.0 (Linux; Android 14) MassWeb";

function asStrings(data: unknown): string[] {
  return Array.isArray(data) && Array.isArray(data[1]) ? (data[1] as unknown[]).filter((item): item is string => typeof item === "string") : [];
}

/** Search suggestions for the address bar: DuckDuckGo's public autocomplete, then Wikipedia. */
export const Route = createFileRoute("/suggest")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
        let list: string[] = [];
        if (q) {
          const sources = [
            `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`,
            `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=8&search=${encodeURIComponent(q)}`,
          ];
          for (const source of sources) {
            try {
              const res = await fetch(source, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(2500) });
              if (!res.ok) continue;
              list = asStrings(await res.json());
              if (list.length) break;
            } catch {
              /* next source */
            }
          }
        }
        const top = list.slice(0, 8);
        const body = url.searchParams.get("format") === "opensearch" ? [q, top] : top;
        return new Response(JSON.stringify(body), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=3600",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
