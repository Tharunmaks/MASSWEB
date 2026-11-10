import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function clientIp(request: Request): string {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}

export const Route = createFileRoute("/ai")({
  server: {
    handlers: {
      GET: async () => {
        const ai = await import("@/lib/browser/ai.server");
        return json({ available: ai.aiAvailable() });
      },
      POST: async ({ request }) => {
        const ai = await import("@/lib/browser/ai.server");
        if (!ai.aiAvailable()) return json({ error: "AI isn't switched on for this deployment." }, 503);
        if (ai.rateLimited(clientIp(request))) return json({ error: "You've asked a lot in the last few minutes. Try again shortly." }, 429);
        let body: import("@/lib/browser/ai.server").AiRequest;
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Bad request." }, 400);
        }
        if (!body || !["page", "tabs", "search", "tidy"].includes(body.mode)) return json({ error: "Bad request." }, 400);

        if (body.mode === "tidy") {
          try {
            const groups = await ai.tidyTabs(body.tabs || []);
            return json({ groups });
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : "Couldn't organise tabs." }, 502);
          }
        }

        const messages = (body.messages || []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
        if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "Ask a question first." }, 400);
        try {
          const { system, sources } = await ai.buildContext(body, request);
          const upstream = await ai.callGrok(system, messages, { stream: true, maxTokens: 1100 });
          if (!upstream.ok) {
            const status = upstream.status;
            return json({ error: status === 429 ? "Grok is busy right now. Try again in a minute." : `The AI answered with an error (${status}).` }, 502);
          }
          return new Response(ai.relayStream(upstream, sources), {
            headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
          });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "The AI request failed." }, 502);
        }
      },
    },
  },
});
