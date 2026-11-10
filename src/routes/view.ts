import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/lib/browser/cors";
import { proxyRequest } from "@/lib/browser/proxy";

export const Route = createFileRoute("/view")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => proxyRequest(request),
      POST: async ({ request }) => proxyRequest(request),
    },
  },
});
