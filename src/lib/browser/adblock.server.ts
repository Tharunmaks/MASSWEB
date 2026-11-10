import { FiltersEngine, Request } from "@ghostery/adblocker";

/**
 * Ad and tracker blocking at the proxy, using Ghostery's engine with the EasyList / uBlock-style
 * "ads and tracking" filter set. The engine is downloaded once per server instance and reused.
 * If it can't load in time, pages are served unblocked rather than slowly.
 */
let enginePromise: Promise<FiltersEngine | null> | null = null;
let failedAt = 0;

function loadEngine(): Promise<FiltersEngine | null> {
  if (enginePromise) return enginePromise;
  if (failedAt && Date.now() - failedAt < 60_000) return Promise.resolve(null);
  enginePromise = FiltersEngine.fromPrebuiltAdsAndTracking(fetch).catch(() => {
    failedAt = Date.now();
    enginePromise = null;
    return null;
  });
  return enginePromise;
}

export async function getEngine(timeoutMs = 2500): Promise<FiltersEngine | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([loadEngine(), timeout]);
}

export type BlockReport = { count: number; hosts: Record<string, number> };

type RequestType = "script" | "image" | "stylesheet" | "sub_frame" | "media" | "object" | "font" | "other";

export function shouldBlock(
  engine: FiltersEngine,
  url: string,
  pageUrl: string,
  type: RequestType,
  report: BlockReport,
): boolean {
  try {
    const result = engine.match(Request.fromRawDetails({ url, sourceUrl: pageUrl, type }));
    if (!result.match) return false;
    report.count += 1;
    const host = new URL(url).hostname.replace(/^www\./, "");
    report.hosts[host] = (report.hosts[host] || 0) + 1;
    return true;
  } catch {
    return false;
  }
}

/** Element-hiding CSS and scriptlets for this page, based on the classes and ids its markup uses. */
export function cosmetics(engine: FiltersEngine, pageUrl: string, markup: string): { css: string; scripts: string[] } {
  try {
    const url = new URL(pageUrl);
    const classes = new Set<string>();
    const ids = new Set<string>();
    const hrefs = new Set<string>();
    for (const match of markup.matchAll(/\sclass\s*=\s*["']([^"']{1,400})["']/gi)) {
      for (const name of match[1].split(/\s+/)) if (name) classes.add(name);
      if (classes.size > 3000) break;
    }
    for (const match of markup.matchAll(/\sid\s*=\s*["']([^"'\s]{1,120})["']/gi)) {
      ids.add(match[1]);
      if (ids.size > 1500) break;
    }
    for (const match of markup.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']{1,300})["']/gi)) {
      hrefs.add(match[1]);
      if (hrefs.size > 800) break;
    }
    const parts = url.hostname.split(".");
    const domain = parts.slice(-2).join(".");
    const result = engine.getCosmeticsFilters({
      url: url.href,
      hostname: url.hostname,
      domain,
      classes: [...classes],
      ids: [...ids],
      hrefs: [...hrefs],
    });
    return { css: result.styles || "", scripts: result.scripts || [] };
  } catch {
    return { css: "", scripts: [] };
  }
}
