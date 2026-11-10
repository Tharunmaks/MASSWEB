/**
 * Where Mass Web's page server lives.
 * - Full app on Vercel: the server is the same site, so the base is "" (relative URLs).
 * - Static app on GitHub Pages: the server is elsewhere (your Vercel URL). It comes from
 *   VITE_MW_SERVER at build time, or from the address saved in Settings / ?server=… .
 */
const KEY = "massweb-server";

export const STATIC_APP = import.meta.env.VITE_MW_STATIC === "1";

function clean(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function serverBase(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return clean(saved);
  } catch {
    /* storage blocked */
  }
  const built = (import.meta.env.VITE_MW_SERVER as string | undefined) || "";
  return clean(built);
}

export function savedServer(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setServer(url: string | null): void {
  try {
    if (url && clean(url)) localStorage.setItem(KEY, clean(url));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

/** The static app can't load pages until it knows its server. */
export function needsServer(): boolean {
  return STATIC_APP && !serverBase();
}

/** Check that an address really is a Mass Web server. */
export async function testServer(url: string): Promise<{ ok: boolean; message: string }> {
  const base = clean(url);
  if (!base) return { ok: false, message: "Type your server address first." };
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as { app?: string };
    if (res.ok && data.app === "mass-web") return { ok: true, message: "Connected" };
    return { ok: false, message: "That address answered, but it isn't a Mass Web server." };
  } catch {
    return { ok: false, message: "Couldn't reach that address. Check it and try again." };
  }
}
