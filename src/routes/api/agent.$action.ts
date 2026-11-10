import { createFileRoute } from "@tanstack/react-router";

const ACTIONS: Record<string, string> = { search: "web_search", read: "open_page", follow: "follow_link", find: "find_in_page", submit: "submit_form", open: "open_pages", research: "research" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, status === 200 ? 0 : 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

async function handle(request: Request, action: string): Promise<Response> {
  const { checkAccess, AgentError } = await import("@/lib/browser/agent.server");
  const denied = checkAccess(request);
  if (denied) return json({ error: denied.message }, denied.status);
  const tool = ACTIONS[action];
  if (!tool) return json({ error: `Unknown action '${action}'. Use one of: ${Object.keys(ACTIONS).join(", ")}.` }, 404);
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
    if (url.searchParams.get("format") === "text") {
      return new Response(out.text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
    }
    return json(out.data);
  } catch (error) {
    if (error instanceof AgentError) return json({ error: error.message }, error.status);
    return json({ error: error instanceof Error ? error.message : "Something went wrong." }, 500);
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
