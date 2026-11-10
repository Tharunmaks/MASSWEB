import { Code2, Copy, Download, ExternalLink, Highlighter, Plus, Rss, Share2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { displayText, hostOf } from "@/lib/browser/destination";
import { copyText, shareLink } from "@/lib/browser/device";
import { serverBase } from "@/lib/browser/server";
import { type Feed, type Tab, useBrowser } from "@/lib/browser/state";
import { toast } from "@/lib/browser/toast";
import { Sheet, SiteIcon } from "./ui";

// ---------------------------------------------------------------- notes & highlights
export function NotesSheet({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (url: string) => void }) {
  const highlights = useBrowser((s) => s.highlights);
  const noteHighlight = useBrowser((s) => s.noteHighlight);
  const removeHighlight = useBrowser((s) => s.removeHighlight);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const pages = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.entries(highlights)
      .map(([url, list]) => ({
        url,
        title: list[0]?.title || hostOf(url),
        list: needle ? list.filter((h) => h.text.toLowerCase().includes(needle) || h.note.toLowerCase().includes(needle)) : list,
        at: Math.max(...list.map((h) => h.at)),
      }))
      .filter((page) => page.list.length)
      .sort((a, b) => b.at - a.at);
  }, [highlights, q]);

  const asMarkdown = () =>
    pages
      .map((p) => `## ${p.title}\n${p.url}\n\n${p.list.map((h) => `> ${h.text}${h.note ? `\n\n${h.note}` : ""}`).join("\n\n")}`)
      .join("\n\n---\n\n");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Notes & highlights"
      height="tall"
      label="Notes and highlights"
      actions={
        pages.length ? (
          <button
            type="button"
            aria-label="Copy all notes as Markdown"
            onClick={async () => (await copyText(asMarkdown())) && toast("Notes copied as Markdown")}
            className="mw-press flex h-10 w-10 items-center justify-center rounded-full text-mute"
          >
            <Copy className="h-[18px] w-[18px]" />
          </button>
        ) : null
      }
    >
      {Object.keys(highlights).length > 3 ? (
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search notes"
          className="mb-2 h-11 w-full rounded-xl bg-stone px-4 text-[15px] outline-none"
        />
      ) : null}
      {pages.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-mute">
          <Highlighter className="mx-auto mb-3 h-8 w-8 opacity-50" />
          Select text on any page and tap <b>Highlight</b>. Your highlights come back every time you revisit the page, and you can add notes to them here.
        </div>
      ) : null}
      <div className="space-y-5 pb-4">
        {pages.map((page) => (
          <div key={page.url}>
            <button type="button" onClick={() => onOpen(page.url)} className="mw-press flex w-full items-center gap-2 py-1 text-left">
              <SiteIcon url={page.url} size={16} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{page.title}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-mute" />
            </button>
            <div className="mt-1 space-y-2">
              {page.list.map((h) => (
                <div key={h.id} className="rounded-2xl bg-stone/60 p-3">
                  <p className="border-l-[3px] border-[#f5c518] pl-3 font-serif text-[15px] leading-snug">{h.text}</p>
                  {editing === h.id ? (
                    <textarea
                      autoFocus
                      defaultValue={h.note}
                      onBlur={(event) => {
                        noteHighlight(page.url, h.id, event.target.value.trim());
                        setEditing(null);
                      }}
                      placeholder="Your note…"
                      className="mt-2 h-20 w-full rounded-xl bg-card p-2.5 text-sm outline-none focus:ring-2 focus:ring-cobalt"
                    />
                  ) : h.note ? (
                    <button type="button" onClick={() => setEditing(h.id)} className="mt-2 block w-full text-left text-sm text-ink">
                      {h.note}
                    </button>
                  ) : null}
                  <div className="mt-1 flex items-center gap-1 text-mute">
                    <span className="flex-1 text-[11px]">{new Date(h.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                    {editing !== h.id ? (
                      <button type="button" onClick={() => setEditing(h.id)} className="mw-press h-8 rounded-full px-3 text-xs">
                        {h.note ? "Edit note" : "Add note"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Delete highlight"
                      onClick={() => removeHighlight(page.url, h.id)}
                      className="mw-press flex h-8 w-8 items-center justify-center rounded-full"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- live feeds (RSS / Atom / GitHub)
type FeedItem = { title: string; link: string; date: number; summary: string };
type FeedData = { feedUrl: string; title: string; link: string; items: FeedItem[] };

export async function loadFeed(url: string): Promise<FeedData> {
  const res = await fetch(`${serverBase()}/feed?u=${encodeURIComponent(url)}`);
  const data = (await res.json()) as FeedData & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error || "Couldn't load that feed.");
  return data;
}

/** Feed URL candidates for a page: its declared feed, or well-known ones for GitHub, Reddit and YouTube. */
export function feedFor(tab: Tab | undefined): string | null {
  if (!tab?.url) return null;
  if (tab.feed) return tab.feed;
  try {
    const url = new URL(tab.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "github.com" && parts.length >= 2) return `https://github.com/${parts[0]}/${parts[1]}/releases.atom`;
    if (/(^|\.)reddit\.com$/.test(url.hostname) && parts[0] === "r" && parts[1]) return `https://www.reddit.com/r/${parts[1]}/.rss`;
  } catch {
    return null;
  }
  return null;
}

export function FeedsSheet({ open, onClose, onOpen, currentTab }: { open: boolean; onClose: () => void; onOpen: (url: string) => void; currentTab: Tab | undefined }) {
  const feeds = useBrowser((s) => s.feeds);
  const follow = useBrowser((s) => s.followFeed);
  const unfollow = useBrowser((s) => s.unfollowFeed);
  const markSeen = useBrowser((s) => s.markFeedSeen);
  const [data, setData] = useState<Record<string, FeedData | { error: string } | undefined>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    for (const feed of feeds) {
      loadFeed(feed.url)
        .then((d) => setData((all) => ({ ...all, [feed.url]: d })))
        .catch((error: Error) => setData((all) => ({ ...all, [feed.url]: { error: error.message } })));
    }
  }, [open, feeds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(url: string) {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const target = /^https?:\/\//i.test(url) ? url.trim() : `https://${url.trim()}`;
      const d = await loadFeed(target);
      follow({ url: d.feedUrl, title: d.title || hostOf(d.link || target), siteUrl: d.link || target });
      setData((all) => ({ ...all, [d.feedUrl]: d }));
      setAdding("");
      toast(`Following ${d.title || hostOf(target)}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't follow that.");
    }
    setBusy(false);
  }

  const suggestion = feedFor(currentTab);
  const unread = (feed: Feed) => {
    const d = data[feed.url];
    return d && "items" in d ? d.items.filter((i) => i.date > feed.lastSeen).length : 0;
  };

  return (
    <Sheet open={open} onClose={onClose} title="Live feeds" height="tall" label="Live feeds">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add(adding);
        }}
      >
        <input
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          placeholder="Paste a site, blog or RSS link"
          inputMode="url"
          className="h-11 min-w-0 flex-1 rounded-xl bg-stone px-4 text-[15px] outline-none focus:ring-2 focus:ring-cobalt"
        />
        <button type="submit" disabled={busy || !adding.trim()} className="mw-press h-11 rounded-xl bg-ink px-4 text-sm text-paper disabled:opacity-40">
          Follow
        </button>
      </form>
      {suggestion && !feeds.some((f) => f.url === suggestion) ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => add(suggestion)}
          className="mw-press mt-3 flex w-full items-center gap-3 rounded-2xl bg-cobalt/10 p-3 text-left text-cobalt"
        >
          <Rss className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">
            Follow <b>{hostOf(currentTab?.url)}</b>
            {suggestion.includes("github.com") ? " releases" : ""}
          </span>
          <Plus className="h-4 w-4" />
        </button>
      ) : null}
      {feeds.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-mute">
          Follow blogs, news sites, subreddits and GitHub repos. New posts show up here without you visiting each site.
        </p>
      ) : null}
      <div className="mt-3 space-y-2 pb-4">
        {feeds.map((feed) => {
          const d = data[feed.url];
          const count = unread(feed);
          const isOpen = expanded === feed.url;
          return (
            <div key={feed.url} className="overflow-hidden rounded-2xl bg-stone/60">
              <button
                type="button"
                onClick={() => {
                  setExpanded(isOpen ? null : feed.url);
                  if (!isOpen) setTimeout(() => markSeen(feed.url), 1200);
                }}
                className="mw-press flex w-full items-center gap-3 p-3 text-left"
              >
                <SiteIcon url={feed.siteUrl} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{feed.title}</span>
                  <span className="block truncate text-xs text-mute">
                    {!d ? "Checking…" : "error" in d ? d.error : `${d.items.length} posts · latest ${d.items[0]?.date ? new Date(d.items[0].date).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}`}
                  </span>
                </span>
                {count ? <span className="rounded-full bg-cobalt px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{count}</span> : null}
              </button>
              {isOpen && d && "items" in d ? (
                <div className="mw-rise border-t border-rule/60 bg-card">
                  {d.items.slice(0, 25).map((item) => (
                    <button key={item.link + item.title} type="button" onClick={() => onOpen(item.link)} className="mw-press block w-full border-b border-rule/40 px-4 py-3 text-left last:border-0">
                      <span className="flex items-start gap-2">
                        {item.date > feed.lastSeen ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cobalt" aria-label="New" /> : null}
                        <span className="min-w-0">
                          <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
                          {item.summary ? <span className="mt-0.5 line-clamp-2 text-xs text-mute">{item.summary}</span> : null}
                        </span>
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      unfollow(feed.url);
                      toast(`Unfollowed ${feed.title}`);
                    }}
                    className="mw-press flex h-11 w-full items-center justify-center gap-2 text-sm text-ember"
                  >
                    <X className="h-4 w-4" /> Unfollow
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- page info + view source
export function PageInfoSheet({ open, onClose, tab, onDownload }: { open: boolean; onClose: () => void; tab: Tab | undefined; onDownload: (url: string) => void }) {
  const [source, setSource] = useState<{ text: string; status: string; bytes: string; type: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) setSource(null);
  }, [open, tab?.url]);
  if (!tab?.url) return null;
  const url = tab.url;
  const secure = url.startsWith("https://");
  const trackers = (tab.trackers || "").split(",").filter(Boolean);
  const loadSource = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${serverBase()}/source?u=${encodeURIComponent(url)}`);
      const text = await res.text();
      setSource({ text, status: res.headers.get("x-mw-status") || String(res.status), bytes: res.headers.get("x-mw-bytes") || String(text.length), type: res.headers.get("x-mw-type") || "" });
    } catch {
      toast("Couldn't load the source.");
    }
    setLoading(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Page info" height={source ? "full" : "auto"} label="Page info">
      <div className="space-y-3 pb-4">
        <div className="flex items-center gap-3 rounded-2xl bg-stone/60 p-3">
          <SiteIcon url={url} icon={tab.icon} size={28} />
          <div className="min-w-0">
            <p className="truncate font-medium">{tab.title}</p>
            <p className="text-xs break-all text-mute">{url}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Info label="Connection" value={secure ? "Secure (HTTPS)" : "Not secure (HTTP)"} tone={secure ? "good" : "bad"} />
          <Info label="Blocked here" value={`${tab.blocked} ads & trackers`} />
          <Info label="Reader mode" value={tab.readable ? "Available" : "Not an article"} />
          <Info label="Feed" value={tab.feed ? "Has RSS/Atom" : "None found"} />
        </dl>
        {trackers.length ? (
          <div className="flex flex-wrap gap-1.5">
            {trackers.map((pair) => (
              <span key={pair} className="rounded-full bg-stone px-2.5 py-1 text-xs">
                {pair.replace(":", " ×")}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={loadSource} disabled={loading} className="mw-press flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm text-paper disabled:opacity-50">
            <Code2 className="h-4 w-4" /> {loading ? "Loading…" : "View source"}
          </button>
          <button type="button" onClick={() => onDownload(url)} className="mw-press flex h-11 items-center gap-2 rounded-full bg-stone px-4 text-sm">
            <Download className="h-4 w-4" /> Download HTML
          </button>
          <button type="button" onClick={async () => (await copyText(url)) && toast("Link copied")} className="mw-press flex h-11 items-center gap-2 rounded-full bg-stone px-4 text-sm">
            <Copy className="h-4 w-4" /> Copy URL
          </button>
        </div>
        {source ? (
          <div className="mw-rise">
            <p className="mb-1.5 text-xs text-mute">
              Status {source.status} · {(Number(source.bytes) / 1024).toFixed(1)} KB · {source.type || "unknown type"} · {source.text.split("\n").length.toLocaleString()} lines
            </p>
            <pre className="max-h-[60dvh] overflow-auto rounded-2xl bg-[#14130f] p-3 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-[#e6dfd2]">
              {source.text.length > 300_000 ? `${source.text.slice(0, 300_000)}\n\n… (showing the first 300 KB)` : source.text}
            </pre>
            <button
              type="button"
              onClick={async () => (await copyText(source.text)) && toast("Source copied")}
              className="mw-press mt-2 flex h-10 items-center gap-2 rounded-full bg-stone px-4 text-sm"
            >
              <Copy className="h-4 w-4" /> Copy source
            </button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl bg-stone/60 p-3">
      <dt className="text-[11px] tracking-wide text-mute uppercase">{label}</dt>
      <dd className={`mt-0.5 font-medium ${tone === "good" ? "text-good" : tone === "bad" ? "text-ember" : ""}`}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- QR code
export function QrSheet({ url, title, onClose }: { url: string | null; title: string; onClose: () => void }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (!url) return;
    let live = true;
    import("qrcode")
      .then((QR) => QR.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17140f", light: "#ffffff" } }))
      .then((out) => live && setSvg(out))
      .catch(() => live && setSvg(""));
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <Sheet open={!!url} onClose={onClose} title="Scan to open" label="QR code">
      <div className="flex flex-col items-center pb-4">
        <div className="mw-pop w-64 max-w-full rounded-3xl bg-white p-4 shadow-ring" aria-label={`QR code for ${url}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="mt-3 max-w-xs truncate text-center text-sm font-medium">{title}</p>
        <p className="max-w-xs truncate text-center text-xs text-mute">{url ? displayText(url) : ""}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={async () => url && (await shareLink(url, title)) === "copied" && toast("Link copied")}
            className="mw-press flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm text-paper"
          >
            <Share2 className="h-4 w-4" /> Share link
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- downloads + backup helpers
export function downloadUrl(url: string): void {
  const a = document.createElement("a");
  a.href = `${serverBase()}/dl?u=${encodeURIComponent(url)}`;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Download started");
}

// ---------------------------------------------------------------- AI agent access (MCP + REST)
export function AgentAccessSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const origin = typeof window === "undefined" ? "" : serverBase() || window.location.origin;
  const mcp = `${origin}/mcp`;
  const config = JSON.stringify({ mcpServers: { "mass-web": { type: "http", url: mcp } } }, null, 2);
  const examples = [
    { label: "Search", value: `${origin}/api/agent/search?q=kochi+metro&format=text` },
    { label: "Read a page", value: `${origin}/api/agent/read?url=en.wikipedia.org/wiki/Kerala&format=text` },
    { label: "Click link 5", value: `${origin}/api/agent/follow?url=news.ycombinator.com&n=5&format=text` },
    { label: "Guide for AIs", value: `${origin}/llms.txt` },
  ];
  const Copyable = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
    <div className="rounded-2xl bg-stone/60 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs font-medium tracking-wide text-mute uppercase">{label}</span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={async () => (await copyText(value)) && toast(`${label} copied`)}
          className="mw-press flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-xs"
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
      </div>
      <p className={`mt-1.5 text-[12.5px] break-all whitespace-pre-wrap ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
  return (
    <Sheet open={open} onClose={onClose} title="Mass Web for AI agents" height="tall" label="AI agent access">
      <p className="text-sm text-mute">
        AI models and agents (your own Mnx, Claude, any MCP client, scripts) can use Mass Web as their browser instead of Chrome. They get pages as clean Markdown with numbered
        links and forms, with ads and trackers already blocked.
      </p>
      <div className="mt-4 space-y-3 pb-4">
        <Copyable label="MCP server URL" value={mcp} />
        <Copyable label="MCP client config" value={config} />
        {examples.map((ex) => (
          <Copyable key={ex.label} label={ex.label} value={ex.value} />
        ))}
        <div className="rounded-2xl border border-rule p-3 text-xs leading-relaxed text-mute">
          <p className="font-medium text-ink">Tools: web_search, open_page, follow_link, find_in_page, submit_form</p>
          <p className="mt-1">
            Agents never sign in or fill passwords, and each caller is limited to 120 calls per 10 minutes. To make it private, set a <code>MASSWEB_AGENT_KEY</code> on
            your server; agents then send it as <code>Authorization: Bearer …</code>.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
