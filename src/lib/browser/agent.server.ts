import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { cleanUrl, destination, unwrapRedirect } from "@/lib/browser/destination";
import { decodePage, fetchPublic, loadTarget, parsePublicUrl } from "@/lib/browser/proxy";

/**
 * Mass Web for AI agents: the same private, ad-blocking proxy the app uses, exposed as
 * page reads an LLM can work with — clean Markdown, numbered links and numbered forms.
 * Everything is stateless: an agent "clicks" by asking for link N of a URL.
 */

export type AgentLink = { n: number; text: string; url: string };
export type AgentField = { name: string; type: string; value: string; label: string; options?: string[] };
export type AgentForm = { n: number; action: string; method: "get" | "post"; fields: AgentField[] };
export type AgentPage = {
  url: string;
  status: number;
  title: string;
  description: string;
  byline: string;
  isArticle: boolean;
  markdown: string;
  truncated: boolean;
  links: AgentLink[];
  forms: AgentForm[];
};

export class AgentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "template", "iframe", "svg", "canvas", "form", "button", "select", "input", "textarea"] as unknown as Parameters<TurndownService["remove"]>[0]);
turndown.addRule("images", {
  filter: "img",
  replacement: (_content, node) => {
    const el = node as unknown as Element;
    const alt = (el.getAttribute("alt") || "").trim();
    return alt ? `[image: ${alt}]` : "";
  },
});

function text(el: Element | null | undefined): string {
  return ((el as HTMLElement | null)?.textContent || "").replace(/\s+/g, " ").trim();
}

function absolute(href: string | null, base: string): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw || /^(javascript:|mailto:|tel:|data:|#)/i.test(raw)) return null;
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return cleanUrl(unwrapRedirect(url.href));
  } catch {
    return null;
  }
}

function extract(markup: string, pageUrl: string, status: number, maxChars: number): AgentPage {
  const { document } = parseHTML(markup);
  const baseHref = document.querySelector("base[href]")?.getAttribute("href");
  const base = baseHref ? new URL(baseHref, pageUrl).href : pageUrl;
  const meta = (name: string) =>
    document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";

  // Links and forms come from the whole page, so agents can navigate menus too.
  const links: AgentLink[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    const url = absolute(a.getAttribute("href"), base);
    if (!url || seen.has(url)) continue;
    const label = text(a) || a.getAttribute("aria-label") || a.getAttribute("title") || "";
    if (!label) continue;
    seen.add(url);
    links.push({ n: links.length + 1, text: label.slice(0, 120), url });
    if (links.length >= 200) break;
  }

  const forms: AgentForm[] = [];
  for (const form of Array.from(document.querySelectorAll("form"))) {
    const fields: AgentField[] = [];
    for (const el of Array.from(form.querySelectorAll("input[name], textarea[name], select[name]"))) {
      const type = (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
      if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
      const id = el.getAttribute("id");
      const label =
        (id && text(document.querySelector(`label[for="${id}"]`))) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
      const field: AgentField = { name: el.getAttribute("name") || "", type, value: el.getAttribute("value") || "", label: label.slice(0, 80) };
      if (el.tagName === "SELECT") {
        field.options = Array.from(el.querySelectorAll("option")).map((o) => o.getAttribute("value") ?? text(o)).slice(0, 30);
        field.value = el.querySelector("option[selected]")?.getAttribute("value") ?? field.options[0] ?? "";
      }
      if (type === "checkbox" || type === "radio") field.value = el.hasAttribute("checked") ? field.value || "on" : "";
      fields.push(field);
    }
    if (!fields.length) continue;
    const method = (form.getAttribute("method") || "get").toLowerCase() === "post" ? "post" : "get";
    forms.push({ n: forms.length + 1, action: absolute(form.getAttribute("action"), base) || pageUrl, method, fields: fields.slice(0, 25) });
    if (forms.length >= 10) break;
  }

  // Main content: the article if Readability finds one, else the cleaned body.
  let title = (document.title || "").trim();
  let byline = "";
  let isArticle = false;
  let html = "";
  try {
    const article = new Readability(parseHTML(markup).document as unknown as Document, { charThreshold: 400 }).parse();
    if (article?.content && (article.textContent || "").length > 600) {
      html = article.content;
      title = article.title || title;
      byline = article.byline || "";
      isArticle = true;
    }
  } catch {
    /* fall back to the body */
  }
  if (!html) {
    for (const el of Array.from(document.querySelectorAll("script, style, noscript, template, svg, [hidden], [aria-hidden='true']"))) el.remove();
    html = document.body?.innerHTML || "";
  }
  let markdown = "";
  try {
    markdown = turndown.turndown(html);
  } catch {
    markdown = text(document.body);
  }
  markdown = markdown
    .replace(/\]\((\/[^)\s]*)\)/g, (_all, path: string) => {
      try {
        return `](${new URL(path, base).href})`;
      } catch {
        return `](${path})`;
      }
    })
    .replace(/\]\(([^)\s]+) "[^"]*"\)/g, "]($1)")
    .replace(/!?\[\s*\]\([^)]*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const truncated = markdown.length > maxChars;
  if (truncated) markdown = `${markdown.slice(0, maxChars)}\n\n…(truncated; ask again with a larger max_chars or use find_in_page)`;

  return {
    url: pageUrl,
    status,
    title,
    description: (meta("og:description") || meta("description")).slice(0, 300),
    byline,
    isArticle,
    markdown,
    truncated,
    links,
    forms,
  };
}

function plainRequest(request: Request): Request {
  return new Request(request.url, { method: "GET", headers: request.headers });
}

export async function readPage(
  input: string,
  request: Request,
  opts: { maxChars?: number; desktop?: boolean } = {},
): Promise<AgentPage> {
  const target = destination(input);
  if (!target) throw new AgentError("Give a URL or a search query.");
  const loaded = await loadTarget(plainRequest(request), target, !!opts.desktop);
  if ("error" in loaded) throw new AgentError("That page couldn't be opened (blocked address, timeout or unreachable site).", 502);
  const { fetched } = loaded;
  const type = fetched.contentType.toLowerCase();
  const body = decodePage(fetched.bytes, type);
  if (!/html|xml/.test(type) && !/^\s*</.test(body.slice(0, 200))) {
    if (/^text\/|json/.test(type)) {
      return {
        url: fetched.finalUrl.href,
        status: fetched.status,
        title: fetched.finalUrl.pathname.split("/").pop() || fetched.finalUrl.hostname,
        description: "",
        byline: "",
        isArticle: false,
        markdown: body.slice(0, opts.maxChars ?? 20_000),
        truncated: body.length > (opts.maxChars ?? 20_000),
        links: [],
        forms: [],
      };
    }
    throw new AgentError(`That address is a file (${fetched.contentType || "unknown type"}), not a page. Download it from /dl?u=…`, 415);
  }
  return extract(body, fetched.finalUrl.href, fetched.status, Math.min(Math.max(opts.maxChars ?? 20_000, 1_000), 120_000));
}

export async function followLink(url: string, n: number, request: Request, maxChars?: number): Promise<AgentPage> {
  const page = await readPage(url, request, { maxChars: 1_000 });
  const link = page.links.find((l) => l.n === n);
  if (!link) throw new AgentError(`Link ${n} doesn't exist on that page (it has ${page.links.length} links).`, 404);
  return readPage(link.url, request, { maxChars });
}

export async function findInPage(url: string, query: string, request: Request): Promise<{ url: string; title: string; matches: string[]; count: number }> {
  if (!query.trim()) throw new AgentError("Say what to find.");
  const page = await readPage(url, request, { maxChars: 120_000 });
  const lower = page.markdown.toLowerCase();
  const needle = query.toLowerCase();
  const matches: string[] = [];
  let at = lower.indexOf(needle);
  let count = 0;
  while (at >= 0) {
    count += 1;
    if (matches.length < 15) matches.push(`…${page.markdown.slice(Math.max(0, at - 160), at + needle.length + 160).replace(/\s+/g, " ")}…`);
    at = lower.indexOf(needle, at + needle.length);
  }
  return { url: page.url, title: page.title, matches, count };
}

export async function submitForm(
  url: string,
  formN: number,
  values: Record<string, string>,
  request: Request,
  maxChars?: number,
): Promise<AgentPage> {
  const page = await readPage(url, request, { maxChars: 1_000 });
  const form = page.forms.find((f) => f.n === formN);
  if (!form) throw new AgentError(`Form ${formN} doesn't exist on that page (it has ${page.forms.length} forms).`, 404);
  const params = new URLSearchParams();
  for (const field of form.fields) {
    const value = Object.prototype.hasOwnProperty.call(values, field.name) ? String(values[field.name]) : field.value;
    if ((field.type === "checkbox" || field.type === "radio") && !value) continue;
    if (/password/i.test(field.type)) throw new AgentError("Mass Web's agent mode doesn't fill in password fields.", 403);
    params.append(field.name, value);
  }
  for (const [name, value] of Object.entries(values)) if (!form.fields.some((f) => f.name === name)) params.append(name, String(value));
  if (form.method === "get") {
    const target = new URL(form.action);
    target.search = params.toString();
    return readPage(target.href, request, { maxChars });
  }
  const action = parsePublicUrl(form.action);
  const post = new Request(request.url, { method: "POST", headers: { ...Object.fromEntries(request.headers), "content-type": "application/x-www-form-urlencoded" } });
  const fetched = await fetchPublic(action, post, "first", new TextEncoder().encode(params.toString()).buffer as ArrayBuffer);
  return extract(decodePage(fetched.bytes, fetched.contentType), fetched.finalUrl.href, fetched.status, Math.min(maxChars ?? 20_000, 120_000));
}

// ---------- access control ----------
const hits = new Map<string, number[]>();

export function clientIp(request: Request): string {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}

/** If MASSWEB_AGENT_KEY is set, require it. Always rate-limit (120 calls / 10 min per caller). */
export function checkAccess(request: Request): AgentError | null {
  const key = process.env.MASSWEB_AGENT_KEY;
  if (key) {
    const url = new URL(request.url);
    const given =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-api-key") || url.searchParams.get("key") || "";
    if (given !== key) return new AgentError("Missing or wrong API key. Send it as 'Authorization: Bearer <key>'.", 401);
  }
  const id = clientIp(request);
  const now = Date.now();
  const list = (hits.get(id) || []).filter((t) => now - t < 600_000);
  if (list.length >= 120) return new AgentError("Too many requests. Slow down and try again in a few minutes.", 429);
  list.push(now);
  hits.set(id, list);
  if (hits.size > 5000) hits.clear();
  return null;
}

/** Plain-text rendering of a page for LLM tool results. */
export function pageAsText(page: AgentPage, opts: { linkLimit?: number } = {}): string {
  const limit = opts.linkLimit ?? 60;
  const lines = [
    `# ${page.title || page.url}`,
    `URL: ${page.url}${page.status !== 200 ? ` (HTTP ${page.status})` : ""}`,
    page.byline ? `By: ${page.byline}` : "",
    page.description ? `Description: ${page.description}` : "",
    "",
    page.markdown,
  ];
  if (page.links.length) {
    lines.push("", `## Links (${page.links.length}${page.links.length > limit ? `, first ${limit} shown` : ""}) — use follow_link with the number`);
    for (const link of page.links.slice(0, limit)) lines.push(`[${link.n}] ${link.text} — ${link.url}`);
  }
  if (page.forms.length) {
    lines.push("", "## Forms — use submit_form with the form number and field values");
    for (const form of page.forms) {
      lines.push(`Form ${form.n}: ${form.method.toUpperCase()} ${form.action}`);
      for (const f of form.fields) lines.push(`  - ${f.name} (${f.type}${f.label ? `, "${f.label}"` : ""})${f.value ? ` = ${f.value}` : ""}${f.options ? ` options: ${f.options.join(" | ")}` : ""}`);
    }
  }
  return lines.filter((line, i) => line !== "" || lines[i - 1] !== "").join("\n");
}
