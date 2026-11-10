import { webSearch } from "@/lib/browser/search.server";
import { AgentError, batchAsText, findInPage, followLink, pageAsText, readPage, readPages, research, researchAsText, submitForm } from "@/lib/browser/agent.server";

/** The tools Mass Web offers AI agents. Shared by the MCP server and the REST API. */
export type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };

const url = { type: "string", description: "Page URL (https://…). A bare domain or a search query also works." };
const maxChars = { type: "integer", description: "Max characters of page text to return (default 20000, up to 120000).", minimum: 1000, maximum: 120000 };

export function toolDefs(): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "web_search",
      description: "Search the web with Mass Search (independent indexes, no Bing/Google). Returns numbered results with title, URL and snippet, plus an instant answer or knowledge card when there is one. Open one with open_page.",
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
    {
      name: "open_pages",
      description:
        "Open up to 20 pages at the same time and return each as clean text with its URL and published date. Results are cached, and near-copies of the same story are reported once. Use this after web_search instead of opening pages one by one.",
      inputSchema: {
        type: "object",
        properties: {
          urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "Page URLs" },
          max_chars: { type: "integer", description: "Max characters per page (default 6000, up to 30000).", minimum: 1000, maximum: 30000 },
        },
        required: ["urls"],
      },
    },
    {
      name: "research",
      description:
        "One call that searches, opens the top results together, drops duplicate stories, and returns numbered sources with URL, published date and text, ready to cite. Set days to keep only pages published in the last N days (pages with no date are left out and listed as skipped).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to research" },
          pages: { type: "integer", minimum: 1, maximum: 12, description: "How many sources to return (default 6)" },
          days: { type: "integer", minimum: 1, description: "Only sources published in the last N days" },
          max_chars: { type: "integer", minimum: 800, maximum: 10000, description: "Max characters per source (default 3000)" },
        },
        required: ["query"],
      },
    },
  ];
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
    case "open_pages": {
      const raw = Array.isArray(args.urls) ? args.urls : typeof args.urls === "string" ? args.urls.split(/[\s,]+/) : [];
      const urls = raw.filter((u): u is string => typeof u === "string" && !!u.trim());
      if (!urls.length) throw new AgentError("'urls' is required: a list of page URLs.");
      const items = await readPages(urls, request, { maxChars: optInt(args.max_chars) });
      return { data: { pages: items }, text: batchAsText(items) };
    }
    case "research": {
      const result = await research(str(args.query, "query"), request, { pages: optInt(args.pages), days: optInt(args.days), maxChars: optInt(args.max_chars) });
      return { data: result, text: researchAsText(result) };
    }
  }
  throw new AgentError(`Unknown tool '${name}'.`, 404);
}
