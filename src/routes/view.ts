import { createFileRoute } from "@tanstack/react-router";
import { proxyRequest } from "@/lib/browser/proxy";

export const Route = createFileRoute("/view")({
  server: {
    handlers: {
      GET: async ({ request }) => proxyRequest(request),
      POST: async ({ request }) => proxyRequest(request),
    },
  },
});
