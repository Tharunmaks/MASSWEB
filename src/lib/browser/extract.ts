import { parse, type HTMLElement } from "node-html-parser";
import type { Block, PageLink } from "./types";

const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "template",
  "nav",
  "footer",
  "aside",
]);

function clean(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isElement(node: unknown): node is HTMLElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "tagName" in node &&
    typeof (node as HTMLElement).tagName === "string"
  );
}

export function looksBlocked(status: number, html: string, title: string): string | null {
  const sample = `${title}\n${html.slice(0, 8000)}`.toLowerCase();
  const challenge =
    sample.includes("just a moment") ||
    sample.includes("cf-challenge") ||
    sample.includes("cf-turnstile") ||
    sample.includes("attention required") ||
    sample.includes("checking your browser") ||
    sample.includes("ddos-guard") ||
    (sample.includes("cloudflare") && (sample.includes("ray id") || sample.includes("challenge")));

  if (challenge) {
    return "The site returned a person-check instead of the page. Mass Web does not solve those.";
  }
  if (status === 401 || status === 403 || status === 429 || status === 503) {
    return `The site refused the read (${status}).`;
  }
  return null;
}

export function extractDocument(html: string, baseUrl: string) {
  const root = parse(html);
  const title =
    clean(root.querySelector("title")?.text) ||
    clean(root.querySelector("h1")?.text) ||
    "";
  const description = clean(
    root.querySelector('meta[name="description"]')?.getAttribute("content") ||
      root.querySelector('meta[property="og:description"]')?.getAttribute("content"),
  );

  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const anchor of root.querySelectorAll("a")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (!abs.startsWith("http://") && !abs.startsWith("https://")) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const text = clean(anchor.text).slice(0, 140);
    links.push({ href: abs, text: text || abs });
    if (links.length >= 40) break;
  }

  for (const node of root.querySelectorAll([...SKIP].join(","))) {
    node.remove();
  }

  const blocks: Block[] = [];
  const origin = root.querySelector("body") ?? root;

  const walk = (el: HTMLElement) => {
    if (blocks.length >= 80) return;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return;
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const text = clean(el.text).slice(0, 240);
      if (text) blocks.push({ type: "h", level: Number(tag[1]) as 1 | 2 | 3, text });
      return;
    }
    if (tag === "p" || tag === "blockquote" || tag === "pre" || tag === "figcaption") {
      const text = clean(el.text).slice(0, 1400);
      if (text.length > 24) blocks.push({ type: "p", text });
      return;
    }
    if (tag === "li") {
      const text = clean(el.text).slice(0, 400);
      if (text.length > 8) blocks.push({ type: "li", text });
      return;
    }
    for (const child of el.childNodes) {
      if (isElement(child)) walk(child);
    }
  };

  walk(origin);

  const headings = blocks
    .filter((block): block is Extract<Block, { type: "h" }> => block.type === "h")
    .map(({ level, text }) => ({ level, text }));

  const text = blocks
    .map((block) => (block.type === "h" ? block.text : block.text))
    .join("\n")
    .slice(0, 14000);

  return { title, description, links, blocks, headings, text };
}
