export type SearchEngine = "bing" | "duckduckgo" | "google";

export const SEARCH_ENGINES: Record<SearchEngine, { name: string; url: (q: string) => string }> = {
  bing: { name: "Bing", url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  duckduckgo: { name: "DuckDuckGo", url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}` },
  google: { name: "Google", url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&gbv=1` },
};

/** Does the typed text look like an address rather than a search? */
export function looksLikeUrl(input: string): boolean {
  const query = input.trim();
  if (!query || /\s/.test(query)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(query)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(query)) return true;
  return /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(query) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(query);
}

export function destination(input: string, engine: SearchEngine = "bing"): string | null {
  const query = input.trim();
  if (!query) return null;
  if (/^https?:\/\//i.test(query)) return cleanUrl(unwrapRedirect(query));
  if (looksLikeUrl(query)) return cleanUrl(`https://${query}`);
  return SEARCH_ENGINES[engine].url(query);
}

/** Query parameters that only exist to track people across sites. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^(fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|oly_anon_id|oly_enc_id|vero_id|rb_clickid|s_cid|ncid|wickedid|__s|ref_src|ref_url)$/i,
];

export function cleanUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? url.href : raw;
}

function googleHost(hostname: string): boolean {
  return /(^|\.)google\.[a-z.]+$/i.test(hostname);
}

function decodeBingTarget(token: string): string | null {
  let body = token.replace(/^a1/i, "").replace(/-/g, "+").replace(/_/g, "/");
  body += "=".repeat((4 - (body.length % 4)) % 4);
  try {
    const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    if (/^https?:\/\//i.test(text)) return text;
    if (text.startsWith("/") && !text.startsWith("//")) return `https://www.bing.com${text}`;
  } catch {
    return null;
  }
  return null;
}

/** Turn tracker hops (Bing / Google / DuckDuckGo) into the page they point at. */
export function unwrapRedirect(raw: string): string {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return current;
    }
    const host = url.hostname.replace(/^www\./i, "");
    let next: string | null = null;
    if (host === "bing.com" || host.endsWith(".bing.com")) {
      if (url.pathname.startsWith("/ck/")) next = decodeBingTarget(url.searchParams.get("u") || "");
    } else if (googleHost(host) && (url.pathname === "/url" || url.pathname === "/imgres")) {
      next = url.searchParams.get("q") || url.searchParams.get("url");
    } else if (host.endsWith("duckduckgo.com") && (url.pathname === "/l" || url.pathname === "/l/")) {
      next = url.searchParams.get("uddg");
    }
    if (!next) return current;
    try {
      const parsed = new URL(next);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return current;
      if (parsed.href === current) return current;
      current = parsed.href;
    } catch {
      return current;
    }
  }
  return current;
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** What the address bar shows when you're not editing: the search terms for a search page, else the host. */
export function displayText(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const isSearch =
      (host.endsWith("bing.com") && parsed.pathname.startsWith("/search")) ||
      (host.endsWith("duckduckgo.com") && (parsed.pathname === "/" || parsed.pathname.startsWith("/html"))) ||
      (googleHost(host) && parsed.pathname === "/search");
    if (isSearch) return parsed.searchParams.get("q") || host;
    return host;
  } catch {
    return url;
  }
}
