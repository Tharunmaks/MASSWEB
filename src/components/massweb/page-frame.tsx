import { useEffect, useRef, useState } from "react";
import { serverBase } from "@/lib/browser/server";

export type FrameInfo = { finalUrl: string; readable: boolean; blocked: number; trackers: string; adblock: string };

const DESKTOP_WIDTH = 1100;

function viewUrl(url: string, opts: { dark: boolean; adblock: boolean; fresh: boolean; desktop: boolean; lite: boolean }): string {
  const params = new URLSearchParams({ u: url });
  if (opts.desktop) params.set("ua", "desktop");
  if (opts.lite) params.set("lite", "1");
  if (opts.dark) params.set("dark", "1");
  if (!opts.adblock) params.set("ab", "0");
  if (opts.fresh) params.set("fresh", String(Date.now()));
  return `${serverBase()}/view?${params.toString()}`;
}

export function PageFrame({
  frameKey,
  url,
  nonce,
  fresh,
  postBody,
  dark,
  adblock,
  desktop = false,
  lite = false,
  title,
  register,
  onInfo,
  onLoaded,
  onExternal,
  onRecover,
}: {
  frameKey: string;
  url: string;
  nonce: number;
  fresh: boolean;
  postBody: string | null;
  dark: boolean;
  adblock: boolean;
  desktop?: boolean;
  lite?: boolean;
  title: string;
  register: (key: string, frame: HTMLIFrameElement | null) => void;
  onInfo: (info: FrameInfo) => void;
  onLoaded: () => void;
  onExternal: () => void;
  onRecover: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [escaped, setEscaped] = useState(false);
  const loads = useRef(0);
  const callbacks = useRef({ onInfo, onLoaded });
  callbacks.current = { onInfo, onLoaded };
  // Settings read once per load; changing them later is pushed to the live page over postMessage.
  const loadOpts = useRef({ dark, adblock, lite });
  loadOpts.current = { dark, adblock, lite };
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el || !desktop) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop, html]);

  useEffect(() => {
    const ac = new AbortController();
    setFailed(false);
    setEscaped(false);
    setHtml(null);
    loads.current = 0;
    const init: RequestInit = { signal: ac.signal, credentials: "same-origin" };
    if (postBody != null) {
      init.method = "POST";
      init.headers = { "content-type": "application/x-www-form-urlencoded" };
      init.body = postBody;
    }
    fetch(viewUrl(url, { ...loadOpts.current, fresh, desktop }), init)
      .then(async (res) => {
        const text = await res.text();
        if (ac.signal.aborted) return;
        callbacks.current.onInfo({
          finalUrl: res.headers.get("x-mw-final-url") || url,
          readable: res.headers.get("x-mw-readable") === "1",
          blocked: Number(res.headers.get("x-mw-blocked") || 0),
          trackers: res.headers.get("x-mw-trackers") || "",
          adblock: res.headers.get("x-mw-adblock") || "0",
        });
        setHtml(text);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (ac.signal.aborted) return;
        setFailed(true);
        callbacks.current.onLoaded();
      });
    return () => ac.abort();
  }, [url, nonce, fresh, postBody, desktop]);

  if (failed) {
    return (
      <div className="grid h-full place-items-center bg-paper px-6 text-center">
        <div className="mw-rise max-w-sm">
          <p className="text-lg font-semibold">You might be offline</p>
          <p className="mt-1 text-sm text-mute">Mass Web couldn't reach its page server. Check your connection and try again.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={onRecover} className="mw-press h-11 rounded-full bg-ink px-5 text-sm text-paper">
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!html) return <Skeleton />;
  const scale = desktop && size.w ? Math.min(1, size.w / DESKTOP_WIDTH) : 1;
  return (
    <div ref={box} className="relative h-full overflow-hidden">
      <iframe
        ref={(node) => register(frameKey, node)}
        title={title || "Page"}
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-popups"
        allow="fullscreen; picture-in-picture; autoplay; encrypted-media"
        allowFullScreen
        referrerPolicy="no-referrer"
        className={`border-0 bg-white ${desktop ? "absolute top-0 left-0 origin-top-left" : "h-full w-full"}`}
        style={desktop ? { width: DESKTOP_WIDTH, height: size.h ? size.h / scale : "100%", transform: `scale(${scale})` } : undefined}
        onLoad={() => {
          loads.current += 1;
          if (loads.current === 1) callbacks.current.onLoaded();
          else setEscaped(true);
        }}
      />
      {escaped ? (
        <div className="absolute inset-0 grid place-items-center bg-paper px-6 text-center">
          <div className="mw-rise max-w-sm">
            <p className="text-lg font-semibold">This page tried to leave Mass Web</p>
            <p className="mt-1 text-sm text-mute">It opened a link in a way the browser can't follow. Go back to the page, or open it in Chrome.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onRecover} className="mw-press h-11 rounded-full bg-ink px-5 text-sm text-paper">
                Back to page
              </button>
              <button type="button" onClick={onExternal} className="mw-press h-11 rounded-full bg-stone px-5 text-sm">
                Open in Chrome
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="h-full overflow-hidden bg-paper px-5 pt-6" aria-hidden>
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-2/3 rounded-lg bg-stone" />
        <div className="h-40 rounded-2xl bg-stone" />
        <div className="h-3.5 w-full rounded bg-stone" />
        <div className="h-3.5 w-11/12 rounded bg-stone" />
        <div className="h-3.5 w-4/5 rounded bg-stone" />
        <div className="h-3.5 w-10/12 rounded bg-stone" />
      </div>
    </div>
  );
}
