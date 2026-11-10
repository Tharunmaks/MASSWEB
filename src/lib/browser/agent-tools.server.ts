import { aiAvailable, buildContext, callGrok, webSearch } from "@/lib/browser/ai.server";
import { AgentError, findInPage, followLink, pageAsText, readPage, submitForm } from "@/lib/browser/agent.server";

/** The tools Mass Web offers AI agents. Shared by the MCP server and the REST API. */
export type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };

const url = { type: "string", description: "Page URL (https://…). A bare domain or a search query also works." };
const maxChars = { type: "integer", description: "Max characters of page text to return (default 20000, up to 120000).", minimum: 1000, maximum: 120000 };

export function toolDefs(): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "web_search",
      description: "Search the web. Returns numbered results with title, URL and snippet. Open one with open_page.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "What to search for" } }, required: ["query"] },
    },
    {
      name: "open_page",
      description:
        "Open a web page through Mass Web (ads and trackers blocked) and return it as clean Markdown, plus numbered links and forms. Use follow_link / submit_form to act on them.",
      inputSchema: { type: "object", properties: { url, max_chars: maxChars, desktop: { type: "boolean", description: "Ask for the desktop version of the site" } }, required: ["url"] },
    },
    {
      name: "follow_link",
      description: "Click link number N from a page you opened (numbers come from open_page) and return the new page.",
      inputSchema: { type: "object", properties: { url, n: { type: "integer", description: "Link number", minimum: 1 }, max_chars: maxChars }, required: ["url", "n"] },
    },
    {
      name: "find_in_page",
      description: "Find text on a page and return the matching passages with context. Good for long pages.",
      inputSchema: { type: "object", properties: { url, query: { type: "string", description: "Text to find" } }, required: ["url", "query"] },
    },
    {
      name: "submit_form",
      description:
        "Fill in and submit form number N on a page (search boxes, filters, simple forms). Fields not given keep their defaults. Password fields are refused.",
      inputSchema: {
        type: "object",
        properties: { url, form: { type: "integer", minimum: 1, description: "Form number from open_page" }, values: { type: "object", additionalProperties: { type: "string" }, description: "Field name → value" }, max_chars: maxChars },
        required: ["url", "form"],
      },
    },
  ];
  if (aiAvailable()) {
    tools.push({
      name: "ask_page",
      description: "Have Grok read a page and answer a question about it (uses the Mass Web owner's AI credits).",
      inputSchema: { type: "object", properties: { url, question: { type: "string" } }, required: ["url", "question"] },
    });
  }
  return tools;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new AgentError(`'${name}' is required.`);
  return v.trim();
}
function int(v: unknown, name: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new AgentError(`'${name}' must be a whole number ≥ 1.`);
  return n;
}
function optInt(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Run a tool. Returns structured data plus a text rendering for LLMs. */
export async function runTool(name: string, args: Record<string, unknown>, request: Request): Promise<{ data: unknown; text: string }> {
  switch (name) {
    case "web_search": {
      const query = str(args.query, "query");
      const results = await webSearch(query, request);
      const text = results.length
        ? results.map((r) => `[${r.n}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n")
        : "No results. Try different words.";
      return { data: { query, results }, text };
    }
    case "open_page": {
      const page = await readPage(str(args.url, "url"), request, { maxChars: optInt(args.max_chars), desktop: args.desktop === true || args.desktop === "1" || args.desktop === "true" });
      return { data: page, text: pageAsText(page) };
    }
    case "follow_link": {
      const page = await followLink(str(args.url, "url"), int(args.n, "n"), request, optInt(args.max_chars));
      return { data: page, text: pageAsText(page) };
    }
    case "find_in_page": {
      const result = await findInPage(str(args.url, "url"), str(args.query, "query"), request);
      const text = result.count ? `${result.count} matches on ${result.url}\n\n${result.matches.join("\n\n")}` : `No matches for "${args.query}" on ${result.url}.`;
      return { data: result, text };
    }
    case "submit_form": {
      const values = (args.values && typeof args.values === "object" ? args.values : {}) as Record<string, string>;
      const page = await submitForm(str(args.url, "url"), int(args.form, "form"), values, request, optInt(args.max_chars));
      return { data: page, text: pageAsText(page) };
    }
    case "ask_page": {
      if (!aiAvailable()) throw new AgentError("AI isn't switched on for this Mass Web deployment.", 503);
      const page = await readPage(str(args.url, "url"), request, { maxChars: 24_000 });
      const question = str(args.question, "question");
      const { system } = await buildContext({ mode: "page", messages: [], page: { url: page.url, title: page.title, text: page.markdown } }, request);
      const res = await callGrok(system, [{ role: "user", content: question }], { stream: false, maxTokens: 900 });
      if (!res.ok) throw new AgentError(`Grok answered ${res.status}.`, 502);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const answer = json.choices?.[0]?.message?.content || "";
      return { data: { url: page.url, question, answer }, text: answer };
    }
  }
  throw new AgentError(`Unknown tool '${name}'.`, 404);
}
