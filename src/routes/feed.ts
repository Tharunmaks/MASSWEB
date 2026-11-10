import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";
import { decodePage, fetchPublic, parsePublicUrl } from "@/lib/browser/proxy";

type Item = { title: string; link: string; date: number; summary: string };

function text(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  const decode = (value: string) =>
    value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_all, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_all, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
      .replace(/&amp;/g, "&");
  // Feeds often escape their HTML, so decode first, then strip tags, then decode what's left.
  return decode(decode(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeed(xml: string, base: string): { title: string; link: string; items: Item[] } {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  const head = xml.slice(0, xml.search(isAtom ? /<entry[\s>]/i : /<item[\s>]/i) >>> 0);
  const siteLink = isAtom ? head.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1] || head.match(/<link[^>]*href=["']([^"']+)/i)?.[1] || "" : text(head, "link");
  const items = blocks.slice(0, 40).map((block) => {
    const link = isAtom
      ? block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1] || block.match(/<link[^>]*href=["']([^"']+)/i)?.[1] || ""
      : text(block, "link") || block.match(/<guid[^>]*>(https?:[^<]+)<\/guid>/i)?.[1] || "";
    const dateText = text(block, isAtom ? "updated" : "pubDate") || text(block, "published") || text(block, "dc:date");
    let abs = link;
    try {
      abs = new URL(link.replace(/&amp;/g, "&"), base).href;
    } catch {
      /* keep raw */
    }
    return {
      title: text(block, "title") || "(untitled)",
      link: abs,
      date: Date.parse(dateText) || 0,
      summary: (text(block, isAtom ? "summary" : "description") || text(block, "content")).slice(0, 240),
    };
  });
  return { title: text(head, "title"), link: siteLink, items };
}

/** Fetch an RSS/Atom feed (or find the feed a web page links to) and return its latest items. */
export const Route = createFileRoute("/feed")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": status === 200 ? "public, max-age=0, s-maxage=300" : "no-store", ...CORS_HEADERS },
          });
        const raw = new URL(request.url).searchParams.get("u") || "";
        try {
          let target = parsePublicUrl(raw);
          let fetched = await fetchPublic(target, request);
          let body = decodePage(fetched.bytes, fetched.contentType);
          if (/<html[\s>]/i.test(body.slice(0, 2000)) && !/<(rss|feed)[\s>]/i.test(body.slice(0, 2000))) {
            const link = body.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
            const href = link?.match(/href=["']([^"']+)/i)?.[1];
            if (!href) return json({ error: "This page has no feed to follow." }, 404);
            target = parsePublicUrl(new URL(href.replace(/&amp;/g, "&"), fetched.finalUrl).href);
            fetched = await fetchPublic(target, request);
            body = decodePage(fetched.bytes, fetched.contentType);
          }
          if (fetched.status >= 400) return json({ error: `The feed answered ${fetched.status}.` }, 502);
          const feed = parseFeed(body, fetched.finalUrl.href);
          if (!feed.items.length && !feed.title) return json({ error: "That isn't a feed Mass Web can read." }, 422);
          return json({ feedUrl: fetched.finalUrl.href, ...feed });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "Couldn't load the feed." }, 502);
        }
      },
    },
  },
});
