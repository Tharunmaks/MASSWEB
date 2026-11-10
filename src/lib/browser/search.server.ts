import { cleanUrl, unwrapRedirect } from "@/lib/browser/destination";

/** Web search for the agent tools: Bing's results page, falling back to DuckDuckGo's HTML page. */
export type Source = { n: number; title: string; url: string; snippet: string };

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Top web results for a query (Bing, falling back to DuckDuckGo's HTML page). */
export async function webSearch(query: string, request: Request): Promise<Source[]> {
  const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  const headers = { "user-agent": ua, "accept-language": request.headers.get("accept-language") || "en-US,en;q=0.9", accept: "text/html" };
  const out: Source[] = [];
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, { headers, signal: AbortSignal.timeout(6000) });
    const html = await res.text();
    for (const block of html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || []) {
      const clean = block.replace(/<link[^>]*>|<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "");
      const head =
        clean.match(/<a[^>]*href="(https?:[^"]+)"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/) || clean.match(/<h2[^>]*>\s*<a[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!head) continue;
      const snippet = clean.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const url = cleanUrl(unwrapRedirect(head[1].replace(/&amp;/g, "&")));
      if (out.some((s) => s.url === url)) continue;
      out.push({ n: out.length + 1, title: stripTags(head[2]), url, snippet: snippet ? stripTags(snippet[1]).slice(0, 300) : "" });
      if (out.length >= 6) break;
    }
  } catch {
    /* try the fallback */
  }
  if (out.length) return out;
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers, signal: AbortSignal.timeout(6000) });
    const html = await res.text();
    const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    links.slice(0, 6).forEach((m, i) => {
      const raw = m[1].startsWith("//") ? `https:${m[1]}` : m[1];
      out.push({ n: i + 1, title: stripTags(m[2]), url: cleanUrl(unwrapRedirect(raw.replace(/&amp;/g, "&"))), snippet: snippets[i] ? stripTags(snippets[i][1]).slice(0, 300) : "" });
    });
  } catch {
    /* no results */
  }
  return out;
}
