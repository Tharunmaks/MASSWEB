import { createFileRoute } from "@tanstack/react-router";

const ACTIONS: Record<string, string> = { search: "web_search", read: "open_page", follow: "follow_link", find: "find_in_page", submit: "submit_form", open: "open_pages", research: "research" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, status === 200 ? 0 : 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}

async function handle(request: Request, action: string): Promise<Response> {
  const { checkAccess, AgentError } = await import("@/lib/browser/agent.server");
  const denied = checkAccess(request);
  const asText = new URL(request.url).searchParams.get("format") !== "json";
  if (denied) return asText ? text(`Error: ${denied.message}\n`, denied.status) : json({ error: denied.message }, denied.status);
  const tool = ACTIONS[action];
  if (!tool) {
    const message = `Unknown action '${action}'. Use one of: ${Object.keys(ACTIONS).join(", ")}.`;
    return asText ? text(`Error: ${message}\n`, 404) : json({ error: message }, 404);
  }
  const url = new URL(request.url);
  const args: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (args.q && !args.query) args.query = args.q;
  if (args.u && !args.url) args.url = args.u;
  if (request.method === "POST") {
    try {
      Object.assign(args, (await request.json()) as Record<string, unknown>);
    } catch {
      return json({ error: "Send a JSON body." }, 400);
    }
  }
  const { runTool } = await import("@/lib/browser/agent-tools.server");
  try {
    const out = await runTool(tool, args, request);
    // Plain text by default (made for AI agents); add format=json for structured data.
    if (url.searchParams.get("format") !== "json") {
      return new Response(out.text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
    }
    return json(out.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    const status = error instanceof AgentError ? error.status : 500;
    return asText ? text(`Error: ${message}\n`, status) : json({ error: message }, status);
  }
}

/** REST API for AI agents: /api/agent/search, /read, /follow, /find, /submit, /open, /research */
export const Route = createFileRoute("/api/agent/$action")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params.action),
      POST: ({ request, params }) => handle(request, params.action),
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, x-api-key" },
        }),
    },
  },
});
