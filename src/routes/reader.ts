import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";
import { decodePage, loadTarget } from "@/lib/browser/proxy";

function json(body: unknown, status = 200, cache = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache ? "public, max-age=0, s-maxage=600, stale-while-revalidate=3600" : "no-store",
      ...CORS_HEADERS,
    },
  });
}

export const Route = createFileRoute("/reader")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => {
        const url = new URL(request.url).searchParams.get("u") || "";
        const loaded = await loadTarget(new Request(request.url, { method: "GET", headers: request.headers }), url);
        if ("error" in loaded) return json({ error: "This page couldn't be loaded." }, 502);
        const { fetched } = loaded;
        if (fetched.status >= 400) return json({ error: `The site answered ${fetched.status}.` }, 502);
        const { extractArticle } = await import("@/lib/browser/reader.server");
        try {
          const article = extractArticle(decodePage(fetched.bytes, fetched.contentType), fetched.finalUrl.href);
          if (!article || article.words < 60) return json({ error: "No article found on this page." }, 422);
          return json(article, 200, true);
        } catch {
          return json({ error: "Reader view couldn't read this page." }, 422);
        }
      },
    },
  },
});
