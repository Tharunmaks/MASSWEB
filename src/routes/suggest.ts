import { createFileRoute } from "@tanstack/react-router";

/** Search suggestions for the address bar (DuckDuckGo's public autocomplete). */
export const Route = createFileRoute("/suggest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 120);
        let list: string[] = [];
        if (q) {
          try {
            const res = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`, {
              headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14) MassWeb", accept: "application/json" },
              signal: AbortSignal.timeout(2500),
            });
            const data = (await res.json()) as unknown;
            if (Array.isArray(data) && Array.isArray(data[1])) list = (data[1] as unknown[]).filter((item): item is string => typeof item === "string");
          } catch {
            list = [];
          }
        }
        return new Response(JSON.stringify(list.slice(0, 8)), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=3600",
          },
        });
      },
    },
  },
});
