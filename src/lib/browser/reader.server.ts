import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";

export type Article = {
  url: string;
  title: string;
  byline: string;
  siteName: string;
  excerpt: string;
  lang: string;
  html: string;
  words: number;
  minutes: number;
};

function absolutize(value: string | undefined, base: string): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Pull the article out of a page (Mozilla Readability) and sanitize it for display in the shell. */
export function extractArticle(markup: string, pageUrl: string): Article | null {
  const { document } = parseHTML(markup);
  const reader = new Readability(document as unknown as Document, { charThreshold: 300, keepClasses: false });
  const parsed = reader.parse();
  if (!parsed || !parsed.content) return null;
  const html = sanitizeHtml(parsed.content, {
    allowedTags: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "em", "strong", "b", "i", "u", "s",
      "sub", "sup", "mark", "small", "a", "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption", "img", "picture", "source",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "span", "div", "section", "article", "aside", "time", "abbr", "q", "cite",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "srcset", "alt", "width", "height", "loading"],
      source: ["srcset", "type", "media"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      time: ["datetime"],
      abbr: ["title"],
      "*": ["lang", "dir"],
    },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, href: absolutize(attribs.href, pageUrl) ?? "" } }),
      img: (tagName, attribs) => {
        const src = absolutize(attribs.src || attribs["data-src"], pageUrl);
        const next: Record<string, string> = { ...attribs, loading: "lazy" };
        if (src) next.src = src;
        else delete next.src;
        if (attribs.srcset) {
          next.srcset = attribs.srcset
            .split(",")
            .map((part) => {
              const [raw, ...rest] = part.trim().split(/\s+/);
              const abs = absolutize(raw, pageUrl);
              return abs ? [abs, ...rest].join(" ") : "";
            })
            .filter(Boolean)
            .join(", ");
        }
        return { tagName, attribs: next };
      },
      source: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          srcset: (attribs.srcset || "")
            .split(",")
            .map((part) => {
              const [raw, ...rest] = part.trim().split(/\s+/);
              const abs = absolutize(raw, pageUrl);
              return abs ? [abs, ...rest].join(" ") : "";
            })
            .filter(Boolean)
            .join(", "),
        },
      }),
    },
  });
  const text = (parsed.textContent || "").replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  return {
    url: pageUrl,
    title: (parsed.title || document.title || "").trim(),
    byline: (parsed.byline || "").trim(),
    siteName: (parsed.siteName || "").trim(),
    excerpt: (parsed.excerpt || "").trim().slice(0, 400),
    lang: parsed.lang || document.documentElement?.getAttribute("lang") || "",
    html,
    words,
    minutes: Math.max(1, Math.round(words / 230)),
  };
}

/** Plain text of a page for the AI: the article if there is one, otherwise the visible body text. */
export function pageText(markup: string, pageUrl: string, limit = 12_000): { title: string; text: string } {
  try {
    const article = extractArticle(markup, pageUrl);
    if (article && article.words > 120) {
      const text = sanitizeHtml(article.html, { allowedTags: [], allowedAttributes: {} })
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      return { title: article.title, text: text.slice(0, limit) };
    }
  } catch {
    /* fall through to raw text */
  }
  const { document } = parseHTML(markup);
  for (const el of Array.from(document.querySelectorAll("script, style, noscript, template, svg, nav, footer, header, [hidden], [aria-hidden='true']"))) {
    el.remove();
  }
  const text = (document.body?.textContent || "").replace(/\s+/g, " ").trim();
  return { title: (document.title || "").trim(), text: text.slice(0, limit) };
}
