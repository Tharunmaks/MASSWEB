import { createFileRoute } from "@tanstack/react-router";
import { decodePage, loadTarget } from "@/lib/browser/proxy";

/** The page's original HTML, as the site sent it (for View source). */
export const Route = createFileRoute("/source")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("u") || "";
        const loaded = await loadTarget(new Request(request.url, { method: "GET", headers: request.headers }), raw);
        if ("error" in loaded) return new Response("This page couldn't be loaded.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
        const { fetched } = loaded;
        const text = decodePage(fetched.bytes.subarray(0, 2_000_000), fetched.contentType);
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-mw-final-url": fetched.finalUrl.href,
            "x-mw-status": String(fetched.status),
            "x-mw-bytes": String(fetched.bytes.byteLength),
            "x-mw-type": fetched.contentType.slice(0, 120),
          },
        });
      },
    },
  },
});
