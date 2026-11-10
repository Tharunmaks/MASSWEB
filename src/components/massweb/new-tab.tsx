import { Search, ShieldCheck, VenetianMask } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { hostOf } from "@/lib/browser/destination";
import { type SavedArticle, listSaved } from "@/lib/browser/offline";
import { useBrowser } from "@/lib/browser/state";
import { SiteIcon } from "./ui";

const DEFAULTS = [
  { name: "Wikipedia", url: "https://en.m.wikipedia.org/" },
  { name: "Hacker News", url: "https://news.ycombinator.com/" },
  { name: "GitHub", url: "https://github.com/" },
  { name: "DuckDuckGo", url: "https://html.duckduckgo.com/html/" },
  { name: "MDN", url: "https://developer.mozilla.org/en-US/" },
  { name: "Lobsters", url: "https://lobste.rs/" },
  { name: "Gutenberg", url: "https://www.gutenberg.org/" },
  { name: "Reddit", url: "https://old.reddit.com/" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function NewTabPage({ incognito, onSearch, onOpen, onOpenSaved, onShield }: {
  incognito: boolean;
  onSearch: () => void;
  onOpen: (url: string) => void;
  onOpenSaved: (article: SavedArticle) => void;
  onShield: () => void;
}) {
  const history = useBrowser((s) => s.history);
  const bookmarks = useBrowser((s) => s.bookmarks);
  const stats = useBrowser((s) => s.stats);
  const [saved, setSaved] = useState<SavedArticle[]>([]);
  useEffect(() => {
    listSaved().then((items) => setSaved(items.slice(0, 3)));
  }, []);

  const top = useMemo(() => {
    const counts = new Map<string, { url: string; title: string; n: number }>();
    for (const item of history.slice(0, 800)) {
      const host = hostOf(item.url);
      if (!host || /bing\.com|duckduckgo\.com|google\./.test(host)) continue;
      const entry = counts.get(host);
      if (entry) entry.n += 1;
      else counts.set(host, { url: new URL(item.url).origin + "/", title: host.split(".").slice(-2, -1)[0] || host, n: 1 });
    }
    const ranked = [...counts.values()].filter((e) => e.n > 1).sort((a, b) => b.n - a.n).map((e) => ({ name: e.title, url: e.url }));
    const out = [...ranked];
    for (const d of DEFAULTS) if (out.length < 8 && !out.some((e) => hostOf(e.url) === hostOf(d.url))) out.push(d);
    return out.slice(0, 8);
  }, [history]);

  const week = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += stats.byDay[new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)] || 0;
    return sum;
  }, [stats]);

  if (incognito) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-paper px-6 text-center">
        <span className="mw-pop flex h-16 w-16 items-center justify-center rounded-3xl bg-stone text-cobalt">
          <VenetianMask className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">You're incognito</h1>
        <p className="mt-2 max-w-sm text-sm text-mute">
          Pages you open in incognito tabs aren't saved to history, aren't restored after you close Mass Web, and leave no search suggestions behind.
        </p>
        <button type="button" onClick={onSearch} className="mw-press mt-8 flex h-14 w-full max-w-md items-center gap-3 rounded-full bg-stone px-5 text-left text-mute">
          <Search className="h-5 w-5" /> Search privately
        </button>
      </div>
    );
  }

  return (
    <div className="mw-noscroll h-full overflow-y-auto bg-paper">
      <div className="mx-auto flex max-w-xl flex-col px-5 pt-[12vh] pb-16">
        <p className="mw-rise text-sm text-mute">{greeting()}</p>
        <h1 className="mw-rise font-serif text-[2.6rem] leading-none font-semibold tracking-tight">Mass Web</h1>
        <button
          type="button"
          onClick={onSearch}
          className="mw-press mw-rise mt-7 flex h-14 items-center gap-3 rounded-full bg-card px-5 text-left text-mute shadow-ring"
        >
          <Search className="h-5 w-5 shrink-0" />
          <span className="flex-1">Search or type web address</span>
        </button>

        <div className="mt-8 grid grid-cols-4 gap-x-2 gap-y-5">
          {top.map((site, i) => (
            <button
              key={site.url}
              type="button"
              onClick={() => onOpen(site.url)}
              style={{ animationDelay: `${40 + i * 25}ms` }}
              className="mw-press mw-rise flex min-w-0 flex-col items-center gap-2"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-card shadow-ring">
                <SiteIcon url={site.url} size={28} />
              </span>
              <span className="w-full truncate text-center text-xs capitalize">{site.name}</span>
            </button>
          ))}
        </div>

        <button type="button" onClick={onShield} className="mw-press mw-rise mt-8 flex items-center gap-3 rounded-2xl bg-card p-4 text-left shadow-ring">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-good/15 text-good">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium tabular-nums">{week.toLocaleString()} ads & trackers blocked</span>
            <span className="block text-xs text-mute">This week · {stats.total.toLocaleString()} all time</span>
          </span>
        </button>

        {saved.length ? (
          <div className="mt-8">
            <p className="pb-2 text-xs font-medium tracking-wide text-mute uppercase">Continue reading</p>
            <div className="space-y-2">
              {saved.map((item) => (
                <button key={item.url} type="button" onClick={() => onOpenSaved(item)} className="mw-press block w-full rounded-2xl bg-card p-4 text-left shadow-ring">
                  <span className="line-clamp-2 font-serif text-[17px] leading-snug font-semibold">{item.title}</span>
                  <span className="mt-1 block text-xs text-mute">
                    {item.siteName || hostOf(item.url)} · {item.minutes} min · offline
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {bookmarks.length ? (
          <div className="mt-8">
            <p className="pb-2 text-xs font-medium tracking-wide text-mute uppercase">Bookmarks</p>
            <div className="mw-noscroll -mx-5 flex gap-2 overflow-x-auto px-5">
              {bookmarks.slice(0, 12).map((item) => (
                <button key={item.url} type="button" onClick={() => onOpen(item.url)} className="mw-press flex h-11 shrink-0 items-center gap-2 rounded-full bg-card px-3.5 text-sm shadow-ring">
                  <SiteIcon url={item.url} size={16} />
                  <span className="max-w-40 truncate">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
