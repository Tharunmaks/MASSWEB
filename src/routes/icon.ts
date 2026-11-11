import { createFileRoute } from "@tanstack/react-router";
import { CORS_HEADERS, preflight } from "@/lib/browser/cors";
import { blockedHost, decodePage, fetchPublic } from "@/lib/browser/proxy";

/**
 * Mass Web's own logo service: GET /icon?host=example.com returns that site's icon.
 * It asks the site itself (its declared icon, then /favicon.ico). For sites that refuse servers it asks
 * DuckDuckGo's icon service from the server, then falls back to a letter badge. The reader's device only
 * ever talks to Mass Web.
 */

const IMAGE = /^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp|svg\+xml|avif)/i;
const WEEK = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";
const PALETTE = ["#2453d6", "#e0592a", "#2f8a55", "#8a4fd3", "#c0392b", "#0f8b8d", "#b7791f", "#4a5568"];

function letter(host: string): Response {
  const name = host.replace(/^www\./, "");
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${PALETTE[hash % PALETTE.length]}"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="600" text-anchor="middle" fill="#fff">${(name[0] || "?").toUpperCase().replace(/[^A-Z0-9]/, "?")}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400, s-maxage=86400", "x-mw-icon": "letter", ...CORS_HEADERS } });
}

function looksLikeImage(bytes: Uint8Array, type: string): boolean {
  if (bytes.length < 70 || bytes.length > 600_000) return false;
  if (IMAGE.test(type)) return true;
  // Some servers send icons as octet-stream: check the first bytes (ICO, PNG, GIF, JPEG).
  const [a, b, c, d] = bytes;
  return (a === 0 && b === 0 && c === 1 && d === 0) || (a === 0x89 && b === 0x50) || (a === 0x47 && b === 0x49) || (a === 0xff && b === 0xd8);
}

function sniffType(bytes: Uint8Array, type: string): string {
  if (IMAGE.test(type)) return type.split(";")[0];
  if (bytes[0] === 0x89) return "image/png";
  if (bytes[0] === 0x47) return "image/gif";
  if (bytes[0] === 0xff) return "image/jpeg";
  return "image/x-icon";
}

async function grab(url: URL, request: Request): Promise<Response | null> {
  try {
    const got = await fetchPublic(url, new Request(request.url, { headers: { accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5" } }));
    if (got.status >= 400 || got.truncated || !looksLikeImage(got.bytes, got.contentType)) return null;
    const type = sniffType(got.bytes, got.contentType);
    return new Response(got.bytes as BodyInit, {
      headers: {
        "content-type": type,
        "cache-control": WEEK,
        "x-content-type-options": "nosniff",
        // An SVG from a stranger must never run scripts.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        ...CORS_HEADERS,
      },
    });
  } catch {
    return null;
  }
}

function declaredIcons(html: string, base: URL): URL[] {
  const found: { url: URL; score: number }[] = [];
  for (const tag of html.slice(0, 200_000).match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/\brel\s*=\s*["']?([^"'>]+)/i)?.[1] || "").toLowerCase();
    if (!/\b(icon|apple-touch-icon)\b/.test(rel) || /mask-icon/.test(rel)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || tag.match(/\bhref\s*=\s*([^\s>]+)/i)?.[1];
    if (!href || href.startsWith("data:")) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), base);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const size = Number(tag.match(/\bsizes\s*=\s*["']?(\d+)x/i)?.[1] || (rel.includes("apple") ? 180 : 32));
      // Prefer something crisp at small sizes without being huge.
      const score = (size >= 48 && size <= 256 ? 3 : size > 256 ? 1 : 2) + (/\.svg(\?|$)/i.test(url.pathname) ? 0.5 : 0);
      found.push({ url, score });
    } catch {
      /* bad href */
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.url).slice(0, 3);
}

export const Route = createFileRoute("/icon")({
  server: {
    handlers: {
      OPTIONS: () => preflight(),
      GET: async ({ request }) => {
        const raw = (new URL(request.url).searchParams.get("host") || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
        if (!raw || raw.length > 253 || !/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(raw) || blockedHost(raw)) return letter(raw || "?");
        const home = new URL(`https://${raw}/`);
        try {
          const page = await fetchPublic(home, request);
          if (page.status < 400 && /html/i.test(page.contentType)) {
            for (const candidate of declaredIcons(decodePage(page.bytes, page.contentType), page.finalUrl)) {
              const icon = await grab(candidate, request);
              if (icon) return icon;
            }
          }
          const fallback = await grab(new URL("/favicon.ico", page.finalUrl), request);
          if (fallback) return fallback;
        } catch {
          /* the front page didn't load; try the usual addresses below */
        }
        const guesses = [`https://${raw}/favicon.ico`, ...(raw.startsWith("www.") ? [] : [`https://www.${raw}/favicon.ico`])];
        for (const guess of guesses) {
          const icon = await grab(new URL(guess), request);
          if (icon) return icon;
        }
        // Last resort for sites that refuse servers: DuckDuckGo's icon service, asked by the server (never by the reader's device).
        const ddg = await grab(new URL(`https://icons.duckduckgo.com/ip3/${raw}.ico`), request);
        if (ddg) return ddg;
        return letter(raw);
      },
    },
  },
});
