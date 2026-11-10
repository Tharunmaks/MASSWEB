import { CORS_HEADERS } from "@/lib/browser/cors";
import { cleanUrl, destination, isMassSearch, unwrapRedirect } from "@/lib/browser/destination";
import { injectedScript } from "@/lib/browser/inject";
import type { BlockReport } from "@/lib/browser/adblock.server";

/** Raw page bytes we read from a site. Rewritten HTML must stay under Vercel's 4.5 MB response cap. */
const MAX_BYTES = 3_500_000;
const MAX_HOPS = 5;
const TIMEOUT_MS = 14_000;

class BlockedAddressError extends Error {}

function blockedIpv4(a: number, b: number): boolean {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

/** True for loopback, private, link-local, CGNAT, metadata and other non-public addresses. */
export function blockedIp(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return true;
    return blockedIpv4(parts[0], parts[1]);
  }
  if (!ip.includes(":")) return false;
  const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = Number.parseInt(mapped[1], 16);
    return blockedIpv4(hi >> 8, hi & 255);
  }
  if (ip === "::" || ip === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true; // link-local fe80::/10
  if (/^ff/.test(ip)) return true; // multicast
  if (/^64:ff9b:/.test(ip)) return true; // NAT64 can reach internal IPv4
  return false;
}

export function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  return blockedIp(host);
}

/** Resolve the host and refuse names that point into a private network (e.g. localtest.me -> 127.0.0.1). */
export async function assertPublicDns(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return;
  try {
    const { lookup } = await import("node:dns/promises");
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.some((entry) => blockedIp(entry.address))) {
      throw new BlockedAddressError("That address points to a private network.");
    }
  } catch (error) {
    if (error instanceof BlockedAddressError) throw error;
    // DNS failures fall through: the fetch itself will report that the site can't be reached.
  }
}

export function parsePublicUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new Error("That address is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public web pages can be opened.");
  }
  if (url.username || url.password) throw new Error("Addresses with a password are blocked.");
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) {
    throw new Error("Only standard web ports can be opened.");
  }
  if (blockedHost(url.hostname)) throw new Error("That address is not a public page.");
  return url;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "\u0026amp;";
      case "<":
        return "\u0026lt;";
      case ">":
        return "\u0026gt;";
      case '"':
        return "\u0026quot;";
      default:
        return "\u0026#39;";
    }
  });
}

function errorDocument(title: string, message: string, url: string, download = false): string {
  const href = JSON.stringify(url).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3ede2;color:#14120e;font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif}
  @media (prefers-color-scheme:dark){body{background:#1b1916;color:#f1ebe0}p{color:#a39b8f!important}button{background:#f1ebe0!important;color:#1b1916!important}}
  main{max-width:30rem;padding:2rem 1.5rem}
  h1{font-size:1.5rem;font-weight:560;letter-spacing:-0.02em;margin:0 0 .5rem}
  p{margin:.4rem 0;color:#5e574e}
  code{font-size:.85rem;word-break:break-all;opacity:.8}
  button{margin-top:1.25rem;height:44px;padding:0 1.25rem;border:0;border-radius:999px;background:#14120e;color:#f3ede2;font:inherit;font-size:.95rem}
</style></head><body><main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<p><code>${escapeHtml(url)}</code></p>
${download ? `<button type="button" id="dl">Download file</button> ` : ""}${url ? `<button type="button" id="ext"${download ? ' style="background:transparent;color:inherit;box-shadow:inset 0 0 0 1.5px currentColor"' : ""}>Open in Chrome</button>` : ""}
</main>
<script>(function(){var u=${href};function p(m){m.source="massweb";parent.postMessage(m,"*")}p({type:"title",title:document.title||""});var b=document.getElementById("ext");if(b)b.onclick=function(){p({type:"external",href:u})};var d=document.getElementById("dl");if(d)d.onclick=function(){p({type:"download",href:u})};})();</script>
</body></html>`;
}

function htmlResponse(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

async function readLimited(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), truncated: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (size + value.byteLength > MAX_BYTES) {
      chunks.push(value.subarray(0, MAX_BYTES - size));
      size = MAX_BYTES;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function upstreamHeaders(request: Request, attempt: "first" | "retry", desktop = false): Record<string, string> {
  const incoming = request.headers.get("user-agent") || "";
  const mobile = !desktop && (attempt === "retry" || /Android|iPhone|iPad|Mobile/i.test(incoming));
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": request.headers.get("accept-language") || "en-US,en;q=0.9",
    "user-agent": mobile
      ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": mobile ? "?1" : "?0",
    "sec-ch-ua-platform": mobile ? '"Android"' : '"Windows"',
    "upgrade-insecure-requests": "1",
  };
  if (attempt === "retry") {
    headers["sec-fetch-dest"] = "document";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-site"] = "none";
    headers["sec-fetch-user"] = "?1";
  }
  return headers;
}

export type Fetched = { finalUrl: URL; status: number; contentType: string; bytes: Uint8Array; truncated: boolean };

export async function fetchPublic(
  start: URL,
  request: Request,
  attempt: "first" | "retry" = "first",
  postBody?: ArrayBuffer,
  desktop = false,
): Promise<Fetched> {
  let current = start;
  const method = postBody ? "POST" : "GET";
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (blockedHost(current.hostname)) throw new BlockedAddressError("Redirected to a non-public address.");
    await assertPublicDns(current.hostname);
    const headers = upstreamHeaders(request, attempt, desktop);
    const contentType = request.headers.get("content-type");
    if (method === "POST" && contentType && hop === 0) headers["content-type"] = contentType;
    const response = await fetch(current.href, {
      method: hop === 0 ? method : "GET",
      body: hop === 0 ? postBody : undefined,
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect had no destination.");
      current = new URL(location, current);
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new Error("Redirect left the public web.");
      }
      current = new URL(cleanUrl(unwrapRedirect(current.href)));
      continue;
    }
    const payload = await readLimited(response);
    return {
      finalUrl: current,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bytes: payload.bytes,
      truncated: payload.truncated,
    };
  }
  throw new Error("Too many redirects.");
}

/** Like fetchPublic, but hands back the unread response so large files can stream through. */
export async function fetchPublicStream(start: URL, request: Request, attempt: "first" | "retry" = "first"): Promise<{ finalUrl: URL; response: Response }> {
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (blockedHost(current.hostname)) throw new BlockedAddressError("Redirected to a non-public address.");
    await assertPublicDns(current.hostname);
    const headers = upstreamHeaders(request, attempt);
    headers.accept = "*/*";
    const response = await fetch(current.href, { redirect: "manual", headers, signal: AbortSignal.timeout(60_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect had no destination.");
      current = new URL(location, current);
      if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("Redirect left the public web.");
      continue;
    }
    if (response.status === 403 && attempt === "first") {
      await response.body?.cancel();
      return fetchPublicStream(current, request, "retry");
    }
    return { finalUrl: current, response };
  }
  throw new Error("Too many redirects.");
}

/** Decode page bytes using the charset from the header or a <meta charset>, defaulting to UTF-8. */
export function decodePage(bytes: Uint8Array, contentType: string): string {
  let label = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  if (!label) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
    label = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(label || "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function decodeEntities(value: string): string {
  let current = value;
  for (let pass = 0; pass < 3; pass++) {
    const next = current.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body: string) => {
      const token = body.toLowerCase();
      if (token === "amp") return "&";
      if (token === "quot") return '"';
      if (token === "apos") return "'";
      if (token === "lt") return "<";
      if (token === "gt") return ">";
      const hex = token.startsWith("#x");
      if (token.startsWith("#")) {
        const code = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }
      return all;
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

function attrEscape(value: string): string {
  return value.replace(/&/g, "\u0026amp;").replace(/"/g, "\u0026quot;");
}

function absoluteUrl(value: string, base: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^(javascript:|data:|blob:|mailto:|tel:|#)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function rewriteSrcset(value: string, base: string): string {
  return value
    .split(",")
    .map((part) => {
      const piece = part.trim();
      if (!piece) return piece;
      const [raw, ...rest] = piece.split(/\s+/);
      const abs = absoluteUrl(raw, base);
      return abs ? [abs, ...rest].join(" ") : piece;
    })
    .join(", ");
}

/** Text inside these elements is raw (JS, CSS, ...). Rewriting markup inside it corrupts the page's scripts. */
const RAW_TEXT = /(<(script|style|textarea|title|xmp|noscript|template)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;

type Blocker = {
  shouldBlock: (url: string, type: "script" | "image" | "stylesheet" | "sub_frame" | "media" | "object") => boolean;
  cosmetics: (markup: string) => { css: string; scripts: string[] };
};

type RewriteResult = { html: string; readable: boolean };

function rewriteHtml(html: string, pageUrl: string, options: { dark: boolean; lite: boolean; blocker: Blocker | null }): RewriteResult {
  const stash: string[] = [];
  const keep = (text: string) => {
    stash.push(text);
    return `\uE000${stash.length - 1}\uE001`;
  };
  const { blocker } = options;
  let source = html.replace(RAW_TEXT, (_all, open: string, _tag: string, body: string, close: string) => open + keep(body) + close);
  source = source.replace(/<!--[\s\S]*?-->/g, (comment) => keep(comment));

  let base = pageUrl;
  const baseTag = source.match(/<base\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (baseTag) {
    try {
      base = new URL(decodeEntities(baseTag[2] ?? baseTag[3] ?? baseTag[4] ?? ""), pageUrl).href;
    } catch {
      base = pageUrl;
    }
  }

  source = source.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
  source = source.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "");
  source = source.replace(/<base\b[^>]*>/gi, "");

  source = source.replace(/<form\b(?![^>]*\baction\s*=)[^>]*>/gi, (open) => {
    return open.replace(/>$/, ` action="${attrEscape(pageUrl)}">`);
  });

  // The page runs in a sandboxed (opaque-origin) frame, so every subresource is cross-origin.
  // Subresource-integrity checks always fail on such no-cors loads, and a crossorigin attribute
  // fails unless the site sends CORS headers. Drop both so scripts and stylesheets load
  // (module scripts are always fetched with CORS, so they keep crossorigin).
  source = source.replace(/<(script|link)\b[^>]*>/gi, (open) => {
    let next = open.replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
    if (/\stype\s*=\s*["']?module/i.test(next)) return next;
    if (/^<link/i.test(next) && !/\srel\s*=\s*["']?stylesheet/i.test(next)) return next;
    next = next.replace(/\scrossorigin(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/i, "");
    return next;
  });

  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const valueOf = (open: string, name: string): string | null => {
    const match = open.match(attr(name));
    if (!match) return null;
    return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  };
  const rewriteTag = (
    tag: string,
    names: string[],
    mode: "nav" | "asset",
    blockType?: "script" | "image" | "stylesheet" | "sub_frame" | "media" | "object",
  ) => {
    const pattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    source = source.replace(pattern, (open) => {
      if (blocker && blockType) {
        const main = valueOf(open, names[0]);
        const abs = main ? absoluteUrl(main, base) : null;
        const isStylesheet = tag !== "link" || /\srel\s*=\s*["']?stylesheet/i.test(open);
        if (abs && isStylesheet && blocker.shouldBlock(abs, blockType)) {
          if (tag === "script") return `<script type="text/mw-blocked">`;
          if (tag === "link") return "";
          return open
            .replace(attr(names[0]), "")
            .replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "")
            .replace(/>$/, " hidden data-mw-blocked>");
        }
      }
      let next = open;
      for (const name of names) {
        next = next.replace(attr(name), (full, _quoted, doubleQuoted, singleQuoted, bare) => {
          const value = decodeEntities(doubleQuoted ?? singleQuoted ?? bare ?? "");
          if (name === "srcset") {
            return ` ${name}="${attrEscape(rewriteSrcset(value, base))}"`;
          }
          if (!value) return full;
          if (mode === "nav" && value.trim().startsWith("#")) return full;
          const abs = absoluteUrl(value, base);
          if (!abs) return full;
          const target = mode === "nav" ? cleanUrl(unwrapRedirect(abs)) : abs;
          return ` ${name}="${attrEscape(target)}"`;
        });
      }
      if (mode === "nav") {
        next = next.replace(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
        next = next.replace(/\sping\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
      }
      return next;
    });
  };

  rewriteTag("a", ["href"], "nav");
  rewriteTag("area", ["href"], "nav");
  rewriteTag("form", ["action"], "nav");
  rewriteTag("img", ["src", "srcset"], "asset", "image");
  rewriteTag("script", ["src"], "asset", "script");
  rewriteTag("link", ["href"], "asset", "stylesheet");
  rewriteTag("source", ["src", "srcset"], "asset", "media");
  rewriteTag("video", ["src", "poster"], "asset", "media");
  rewriteTag("audio", ["src"], "asset", "media");
  rewriteTag("iframe", ["src"], "asset", "sub_frame");
  rewriteTag("embed", ["src"], "asset", "object");
  rewriteTag("object", ["data"], "asset", "object");

  if (options.lite) {
    // Data saver: images, video and embeds wait until tapped.
    source = source.replace(/<(img|source|iframe|video|audio)\b[^>]*>/gi, (open) => {
      let next = open.replace(/\s(src|srcset|poster)\s*=/gi, (_all, name: string) => ` data-mw-${name.toLowerCase()}=`);
      next = next.replace(/\sautoplay\b(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi, "");
      return next.replace(/>$/, " data-mw-lite>");
    });
  }

  const readable = looksReadable(source);

  let extras = "";
  if (blocker) {
    const { css, scripts } = blocker.cosmetics(source);
    if (css) extras += `<style id="mw-cosmetic">${css.replace(/<\/style/gi, "<\\/style")}</style>`;
    for (const script of scripts.slice(0, 40)) {
      extras += `<script>try{${script.replace(/<\/script/gi, "<\\/script")}}catch(e){}</script>`;
    }
  }

  const inject = `<base href="${attrEscape(base)}">${injectedScript(pageUrl, { dark: options.dark, block: !!blocker, lite: options.lite })}${extras}`;
  if (/<head(\s[^>]*)?>/i.test(source)) {
    source = source.replace(/<head(\s[^>]*)?>/i, (open) => open + inject);
  } else if (/<html(\s[^>]*)?>/i.test(source)) {
    source = source.replace(/<html(\s[^>]*)?>/i, (open) => open + inject);
  } else if (/<!doctype[^>]*>/i.test(source)) {
    source = source.replace(/<!doctype[^>]*>/i, (open) => open + inject);
  } else {
    source = inject + source;
  }

  for (let pass = 0; pass < 4 && /\uE000\d+\uE001/.test(source); pass++) {
    source = source.replace(/\uE000(\d+)\uE001/g, (_all, index: string) => stash[Number(index)] ?? "");
  }
  return { html: source, readable };
}

/** Cheap article check: several real paragraphs of prose means reader mode is worth offering. */
function looksReadable(markup: string): boolean {
  let long = 0;
  for (const match of markup.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = match[1]
      .replace(/\uE000\d+\uE001/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 120) long += 1;
    if (long >= 4) return true;
  }
  return false;
}

function declaredRedirect(html: string, base: string, totalLength: number): string | null {
  const refresh =
    html.match(/http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*?url\s*=\s*([^"'>\s]+)/i) ||
    html.match(/content\s*=\s*["'][^"']*?url\s*=\s*([^"'>\s]+)[^"']*["'][^>]*http-equiv\s*=\s*["']?refresh/i);
  if (refresh) {
    const target = absoluteUrl(decodeEntities(refresh[1]), base);
    if (target && target !== base) return target;
  }
  if (totalLength > 40_000) return null;
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (visible.length > 240) return null;
  const near =
    html.match(/["'](https?:\/\/[^"']+)["'][\s\S]{0,500}?location\s*(?:\.\s*(?:href|replace|assign))?\s*(?:=|\()/i) ||
    html.match(/location\s*(?:\.\s*(?:href|replace|assign))?\s*(?:=|\()[\s\S]{0,240}?["'](https?:\/\/[^"']+)["']/i);
  if (!near) return null;
  const target = absoluteUrl(decodeEntities(near[1]), base);
  if (!target || target !== base) return target;
  return null;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "The page did not load.";
  if (/timeout|aborted/i.test(message)) return "The site took too long to answer.";
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(message)) return "That site's address couldn't be found.";
  if (/ECONNREFUSED|ECONNRESET|fetch failed/i.test(message)) return "The site couldn't be reached.";
  return message;
}

/** Load the page the shell asked for (and follow HTML/JS redirects) without rewriting it. */
export async function loadTarget(
  request: Request,
  raw: string,
  desktop = false,
): Promise<{ target: URL; fetched: Fetched } | { error: Response }> {
  const targetRaw = raw ? cleanUrl(unwrapRedirect(raw)) : "";
  if (!targetRaw) return { error: htmlResponse(errorDocument("No address", "The browser did not ask for a page.", "")) };
  let target: URL;
  try {
    target = parsePublicUrl(targetRaw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "That address is blocked.";
    return { error: htmlResponse(errorDocument("Can't open this page", message, targetRaw)) };
  }
  try {
    const postBody = request.method.toUpperCase() === "POST" ? await request.arrayBuffer() : undefined;
    let fetched = await fetchPublic(target, request, "first", postBody, desktop);
    if (fetched.status === 403 && !postBody) {
      fetched = await fetchPublic(target, request, "retry", undefined, desktop);
    }
    const seen = new Set<string>([fetched.finalUrl.href]);
    for (let hop = 0; hop < 3 && fetched.status !== 403; hop++) {
      const probeType = fetched.contentType.toLowerCase();
      const probe = decodePage(fetched.bytes.subarray(0, 60_000), probeType);
      const probeHtml = probeType.includes("html") || probeType.includes("xml") || /^\s*</.test(probe.slice(0, 200));
      if (!probeHtml) break;
      const next = declaredRedirect(probe, fetched.finalUrl.href, fetched.bytes.length);
      if (!next || seen.has(next)) break;
      let nextUrl: URL;
      try {
        nextUrl = parsePublicUrl(cleanUrl(unwrapRedirect(next)));
      } catch {
        break;
      }
      seen.add(next);
      fetched = await fetchPublic(nextUrl, request, "first", undefined, desktop);
      if (fetched.status === 403) fetched = await fetchPublic(nextUrl, request, "retry", undefined, desktop);
    }
    return { target, fetched };
  } catch (error) {
    return { error: htmlResponse(errorDocument("Can't open this page", friendlyError(error), target.href)) };
  }
}

export async function proxyRequest(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const params = requestUrl.searchParams;
  const explicit = params.get("u");
  const typed = params.get("q") || "";
  const picked = (explicit && explicit.trim()) || destination(typed) || "";
  const dark = params.get("dark") === "1";
  const adblock = params.get("ab") !== "0";
  const fresh = params.has("fresh");
  const desktop = params.get("ua") === "desktop";
  const lite = params.get("lite") === "1";

  if (isMassSearch(picked)) {
    // Mass Web's own search results page.
    const search = new URL(picked);
    const query = search.searchParams.get("q") || "";
    const page = Number(search.searchParams.get("p") || "1") || 1;
    const [{ massSearch }, { renderSearchPage }] = await Promise.all([import("@/lib/browser/masssearch.server"), import("@/lib/browser/search-page.server")]);
    const data = await massSearch(query, request, page);
    return htmlResponse(renderSearchPage(data, { dark, embedded: true }), 200, {
      "cache-control": query && !fresh ? "public, max-age=0, s-maxage=120, stale-while-revalidate=600" : "no-store",
      "x-mw-final-url": picked,
      "x-mw-status": "200",
      "x-mw-readable": "0",
    });
  }

  const [loaded, engine] = await Promise.all([
    loadTarget(request, picked, desktop),
    adblock ? import("@/lib/browser/adblock.server").then((mod) => mod.getEngine()) : Promise.resolve(null),
  ]);
  if ("error" in loaded) return loaded.error;
  const { fetched } = loaded;

  if (fetched.status === 403) {
    return htmlResponse(
      errorDocument("This site blocked Mass Web", "The site refused to send the page to the browser's server (403).", fetched.finalUrl.href),
      200,
      { "x-mw-final-url": fetched.finalUrl.href },
    );
  }
  const finalHref = fetched.finalUrl.href;
  const type = fetched.contentType.toLowerCase();
  const text = decodePage(fetched.bytes, type);
  const looksHtml = type.includes("html") || type.includes("xml") || /^\s*</.test(text.slice(0, 200));
  if (!looksHtml) {
    if (type.startsWith("image/")) {
      const src = escapeHtml(finalHref);
      return htmlResponse(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(fetched.finalUrl.pathname.split("/").pop() || fetched.finalUrl.hostname)}</title>${injectedScript(finalHref)}</head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#111"><img src="${src}" alt="" style="max-width:100%;height:auto"></body></html>`,
        200,
        { "x-mw-final-url": finalHref },
      );
    }
    return htmlResponse(
      errorDocument(
        fetched.finalUrl.hostname,
        `This address is a file (${fetched.contentType || "unknown type"}), not a web page.`,
        finalHref,
        true,
      ),
      200,
      { "x-mw-final-url": finalHref },
    );
  }

  const report: BlockReport = { count: 0, hosts: {} };
  let blocker: Blocker | null = null;
  if (engine) {
    const mod = await import("@/lib/browser/adblock.server");
    blocker = {
      shouldBlock: (url, kind) => mod.shouldBlock(engine, url, finalHref, kind, report),
      cosmetics: (markup) => mod.cosmetics(engine, finalHref, markup),
    };
  }
  const { html, readable } = rewriteHtml(text, finalHref, { dark, lite, blocker });
  const trackers = Object.entries(report.hosts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([host, count]) => `${host}:${count}`)
    .join(",");
  const cacheable = request.method === "GET" && !fresh && fetched.status === 200 && !fetched.truncated;
  return htmlResponse(html, 200, {
    "cache-control": cacheable ? "public, max-age=0, s-maxage=180, stale-while-revalidate=900" : "no-store",
    "x-mw-final-url": finalHref,
    "x-mw-status": String(fetched.status),
    "x-mw-readable": readable ? "1" : "0",
    "x-mw-blocked": String(report.count),
    "x-mw-trackers": trackers,
    "x-mw-adblock": engine ? "1" : adblock ? "unavailable" : "0",
  });
}
