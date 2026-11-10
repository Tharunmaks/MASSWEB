import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  History,
  Image as ImageIcon,
  Languages,
  Monitor,
  NotebookPen,
  QrCode,
  Rss,
  Info,
  Upload,
  Minus,
  Moon,
  Plus,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  VenetianMask,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { SEARCH_ENGINES, type SearchEngine, displayText, hostOf } from "@/lib/browser/destination";
import { canSpeak } from "@/lib/browser/device";
import { type SavedArticle, listSaved, removeSaved, saveArticle } from "@/lib/browser/offline";
import { type Tab, useBrowser } from "@/lib/browser/state";
import { toast } from "@/lib/browser/toast";
import { LANGUAGES } from "@/lib/browser/translate";
import { Row, Segmented, Sheet, SiteIcon, Toggle } from "./ui";

export type MenuAction =
  | "back"
  | "forward"
  | "reload"
  | "bookmark"
  | "share"
  | "new-tab"
  | "incognito"
  | "bookmarks"
  | "history"
  | "saved"
  | "reader"
  | "listen"
  | "translate"
  | "find"
  | "dark"
  | "split"
  | "boost"
  | "shield"
  | "save-offline"
  | "external"
  | "settings"
  | "copy"
  | "ask"
  | "notes"
  | "feeds"
  | "desktop"
  | "info"
  | "qr";

function Tile({ icon, label, onClick, active, disabled }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mw-press flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1 text-center disabled:opacity-35"
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${active ? "bg-cobalt text-white" : "bg-stone text-ink"}`}>{icon}</span>
      <span className="line-clamp-2 text-[11.5px] leading-tight">{label}</span>
    </button>
  );
}

export function MenuSheet({
  open,
  onClose,
  tab,
  zoom,
  onZoom,
  dark,
  desktop,
  split,
  aiOn,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  tab: Tab | undefined;
  zoom: number;
  onZoom: (zoom: number) => void;
  dark: boolean;
  desktop: boolean;
  split: boolean;
  aiOn: boolean;
  onAction: (action: MenuAction) => void;
}) {
  const bookmarked = useBrowser((s) => !!tab?.url && s.bookmarks.some((b) => b.url === tab.url));
  const page = !!tab?.url;
  const canBack = !!tab && tab.index > 0;
  const canForward = !!tab && tab.index < tab.history.length - 1;
  return (
    <Sheet open={open} onClose={onClose} label="Menu">
      <div className="flex items-center justify-between gap-1 pb-3">
        <IconButton label="Back" disabled={!canBack} onClick={() => onAction("back")}>
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <IconButton label="Forward" disabled={!canForward} onClick={() => onAction("forward")}>
          <ArrowRight className="h-5 w-5" />
        </IconButton>
        <IconButton label={bookmarked ? "Remove bookmark" : "Bookmark"} disabled={!page} onClick={() => onAction("bookmark")}>
          <Star className={`h-5 w-5 ${bookmarked ? "fill-current text-cobalt" : ""}`} />
        </IconButton>
        <IconButton label="Reload" disabled={!page} onClick={() => onAction("reload")}>
          <RotateCw className="h-5 w-5" />
        </IconButton>
        <IconButton label="Share" disabled={!page} onClick={() => onAction("share")}>
          <Share2 className="h-5 w-5" />
        </IconButton>
        <IconButton label="Settings" onClick={() => onAction("settings")}>
          <SettingsIcon className="h-5 w-5" />
        </IconButton>
      </div>
      {page ? (
        <button
          type="button"
          onClick={() => onAction("ask")}
          className="mw-press mb-3 flex w-full items-center gap-3 rounded-2xl bg-ink p-3.5 text-left text-paper"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper/15">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Ask Grok about this page</span>
            <span className="block truncate text-xs opacity-70">{aiOn ? "Summaries, answers, your Skills, compare tabs" : "Turns on when you publish from Grok"}</span>
          </span>
        </button>
      ) : null}
      {page ? (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-stone/70 px-3 py-2">
          <SiteIcon url={tab?.url ?? null} icon={tab?.icon} size={22} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{tab?.title}</p>
            <p className="truncate text-xs text-mute">{hostOf(tab?.url)}</p>
          </div>
          <div className="flex shrink-0 items-center rounded-full bg-card">
            <button type="button" aria-label="Zoom out" onClick={() => onZoom(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))} className="mw-press flex h-9 w-9 items-center justify-center rounded-full">
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Reset zoom" onClick={() => onZoom(1)} className="w-11 text-center text-xs tabular-nums">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => onZoom(Math.min(2.5, Math.round((zoom + 0.1) * 10) / 10))} className="mw-press flex h-9 w-9 items-center justify-center rounded-full">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-4 gap-1 pb-2">
        <Tile icon={<Plus className="h-5 w-5" />} label="New tab" onClick={() => onAction("new-tab")} />
        <Tile icon={<VenetianMask className="h-5 w-5" />} label="Incognito tab" onClick={() => onAction("incognito")} />
        <Tile icon={<Bookmark className="h-5 w-5" />} label="Bookmarks" onClick={() => onAction("bookmarks")} />
        <Tile icon={<History className="h-5 w-5" />} label="History" onClick={() => onAction("history")} />
        <Tile icon={<BookOpen className="h-5 w-5" />} label="Reader" disabled={!page} onClick={() => onAction("reader")} />
        <Tile icon={<Volume2 className="h-5 w-5" />} label="Listen" disabled={!page || !canSpeak()} onClick={() => onAction("listen")} />
        <Tile icon={<Languages className="h-5 w-5" />} label="Translate" disabled={!page} onClick={() => onAction("translate")} />
        <Tile icon={<Search className="h-5 w-5" />} label="Find in page" disabled={!page} onClick={() => onAction("find")} />
        <Tile icon={<Moon className="h-5 w-5" />} label="Dark page" active={dark} disabled={!page} onClick={() => onAction("dark")} />
        <Tile icon={<Monitor className="h-5 w-5" />} label="Desktop site" active={desktop} disabled={!page} onClick={() => onAction("desktop")} />
        <Tile icon={<Columns2 className="h-5 w-5" />} label={split ? "Close split" : "Split view"} active={split} onClick={() => onAction("split")} />
        <Tile icon={<Wand2 className="h-5 w-5" />} label="Boost site" disabled={!page} onClick={() => onAction("boost")} />
        <Tile icon={<ShieldCheck className="h-5 w-5" />} label="Shields" onClick={() => onAction("shield")} />
        <Tile icon={<NotebookPen className="h-5 w-5" />} label="Notes" onClick={() => onAction("notes")} />
        <Tile icon={<Rss className="h-5 w-5" />} label="Feeds" onClick={() => onAction("feeds")} />
        <Tile icon={<BookOpen className="h-5 w-5" />} label="Saved pages" onClick={() => onAction("saved")} />
        <Tile icon={<Download className="h-5 w-5" />} label="Save offline" disabled={!page} onClick={() => onAction("save-offline")} />
        <Tile icon={<QrCode className="h-5 w-5" />} label="QR code" disabled={!page} onClick={() => onAction("qr")} />
        <Tile icon={<Info className="h-5 w-5" />} label="Page info" disabled={!page} onClick={() => onAction("info")} />
        <Tile icon={<ExternalLink className="h-5 w-5" />} label="Open in Chrome" disabled={!page} onClick={() => onAction("external")} />
      </div>
    </Sheet>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="mw-press flex h-12 flex-1 items-center justify-center rounded-2xl bg-stone disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export function HistorySheet({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (url: string) => void }) {
  const history = useBrowser((s) => s.history);
  const forget = useBrowser((s) => s.forget);
  const clear = useBrowser((s) => s.clearHistory);
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = needle ? history.filter((item) => item.title.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle)) : history;
    const out: { label: string; items: typeof history }[] = [];
    for (const item of items.slice(0, 400)) {
      const label = dayLabel(item.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(item);
      else out.push({ label, items: [item] });
    }
    return out;
  }, [history, q]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="History"
      height="tall"
      label="History"
      actions={
        history.length ? (
          <button
            type="button"
            onClick={() => {
              clear();
              toast("History cleared");
            }}
            className="mw-press h-9 rounded-full px-3 text-sm text-ember"
          >
            Clear
          </button>
        ) : null
      }
    >
      <SearchField value={q} onChange={setQ} placeholder="Search history" />
      {groups.length === 0 ? <Empty text={q ? "Nothing matches." : "Pages you visit show up here. Incognito tabs are never saved."} /> : null}
      {groups.map((group) => (
        <div key={group.label} className="mt-4">
          <p className="px-1 pb-1 text-xs font-medium tracking-wide text-mute uppercase">{group.label}</p>
          {group.items.map((item) => (
            <div key={`${item.url}-${item.at}`} className="flex items-center">
              <div className="min-w-0 flex-1">
                <Row
                  icon={<SiteIcon url={item.url} size={18} />}
                  title={item.title || hostOf(item.url)}
                  detail={`${new Date(item.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${displayText(item.url)}`}
                  onClick={() => onOpen(item.url)}
                />
              </div>
              <button type="button" aria-label="Remove from history" onClick={() => forget(item.url, item.at)} className="mw-press flex h-11 w-11 shrink-0 items-center justify-center text-mute">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </Sheet>
  );
}

export function BookmarksSheet({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (url: string) => void }) {
  const bookmarks = useBrowser((s) => s.bookmarks);
  const toggle = useBrowser((s) => s.toggleBookmark);
  const [q, setQ] = useState("");
  const items = bookmarks.filter((item) => !q || item.title.toLowerCase().includes(q.toLowerCase()) || item.url.includes(q.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title="Bookmarks" height="tall" label="Bookmarks">
      {bookmarks.length > 6 ? <SearchField value={q} onChange={setQ} placeholder="Search bookmarks" /> : null}
      {items.length === 0 ? <Empty text="Tap the star in the menu to bookmark a page." /> : null}
      <div className="mt-2">
        {items.map((item) => (
          <div key={item.url} className="flex items-center">
            <div className="min-w-0 flex-1">
              <Row icon={<SiteIcon url={item.url} size={18} />} title={item.title} detail={displayText(item.url)} onClick={() => onOpen(item.url)} />
            </div>
            <button
              type="button"
              aria-label="Remove bookmark"
              onClick={() => {
                toggle(item.url, item.title);
                toast("Bookmark removed", { label: "Undo", run: () => useBrowser.getState().toggleBookmark(item.url, item.title) });
              }}
              className="mw-press flex h-11 w-11 shrink-0 items-center justify-center text-mute"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export function SavedSheet({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (article: SavedArticle) => void }) {
  const [items, setItems] = useState<SavedArticle[] | null>(null);
  useEffect(() => {
    if (open) listSaved().then(setItems);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Saved pages" height="tall" label="Saved pages">
      {items && items.length === 0 ? <Empty text="Open a page in Reader and tap the bookmark icon to keep it for offline reading." /> : null}
      <div className="mt-1 space-y-2">
        {(items ?? []).map((item) => (
          <div key={item.url} className="flex items-start gap-2 rounded-2xl bg-stone/60 p-3">
            <button type="button" onClick={() => onOpen(item)} className="mw-press min-w-0 flex-1 text-left">
              <p className="line-clamp-2 font-serif text-[17px] leading-snug font-semibold">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-mute">{item.excerpt}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-mute">
                <SiteIcon url={item.url} size={12} />
                {item.siteName || hostOf(item.url)} · {item.minutes} min
              </p>
            </button>
            <button
              type="button"
              aria-label="Delete saved page"
              onClick={async () => {
                await removeSaved(item.url);
                setItems((list) => (list ?? []).filter((x) => x.url !== item.url));
              }}
              className="mw-press flex h-10 w-10 shrink-0 items-center justify-center text-mute"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export function ShieldSheet({ open, onClose, tab, onChanged }: { open: boolean; onClose: () => void; tab: Tab | undefined; onChanged: () => void }) {
  const stats = useBrowser((s) => s.stats);
  const settings = useBrowser((s) => s.settings);
  const setSettings = useBrowser((s) => s.setSettings);
  const sites = useBrowser((s) => s.sites);
  const setSite = useBrowser((s) => s.setSite);
  const host = hostOf(tab?.url);
  const siteOn = host ? (sites[host]?.adblock ?? settings.adblock) : settings.adblock;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString(undefined, { weekday: "narrow" }), value: stats.byDay[key] || 0 };
  });
  const week = days.reduce((sum, d) => sum + d.value, 0);
  const peak = Math.max(1, ...days.map((d) => d.value));
  const top = Object.entries(stats.byHost)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const pageTrackers = (tab?.trackers || "")
    .split(",")
    .filter(Boolean)
    .map((pair) => pair.split(":"));
  return (
    <Sheet open={open} onClose={onClose} title="Shields" height="tall" label="Privacy shields">
      <div className="rounded-3xl bg-ink p-5 text-paper">
        <p className="text-sm opacity-70">Ads and trackers blocked this week</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">{week.toLocaleString()}</p>
        <div className="mt-4 flex h-20 items-end gap-2" aria-label="Blocked per day, last 7 days">
          {days.map((d) => (
            <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-md bg-good" style={{ height: `${Math.max(4, (d.value / peak) * 64)}px`, opacity: d.value ? 1 : 0.25 }} title={`${d.value}`} />
              <span className="text-[10px] opacity-60">{d.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs opacity-60">{stats.total.toLocaleString()} blocked since you started using Mass Web.</p>
      </div>

      {host ? (
        <div className="mt-5">
          <div className="flex items-center gap-3 py-2">
            <SiteIcon url={tab?.url ?? null} icon={tab?.icon} size={22} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{host}</p>
              <p className="text-xs text-mute">{tab?.blocked ? `${tab.blocked} blocked on this page` : "Nothing blocked on this page"}</p>
            </div>
            <Toggle
              label={`Block ads on ${host}`}
              checked={siteOn}
              onChange={(next) => {
                setSite(tab!.url!, { adblock: next === settings.adblock ? undefined : next });
                toast(next ? `Shields up for ${host}` : `Shields down for ${host}`);
                onChanged();
              }}
            />
          </div>
          {pageTrackers.length ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {pageTrackers.map(([h, n]) => (
                <span key={h} className="rounded-full bg-stone px-2.5 py-1 text-xs">
                  {h} <span className="text-mute">×{n}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 border-t border-rule pt-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Block ads and trackers everywhere</p>
            <p className="text-xs text-mute">Uses EasyList and uBlock-style filters on every page.</p>
          </div>
          <Toggle label="Block ads everywhere" checked={settings.adblock} onChange={(adblock) => setSettings({ adblock })} />
        </div>
      </div>

      {top.length ? (
        <div className="mt-5">
          <p className="pb-1 text-xs font-medium tracking-wide text-mute uppercase">Most blocked</p>
          {top.map(([h, n]) => (
            <div key={h} className="flex items-center gap-3 py-2">
              <SiteIcon url={`https://${h}`} size={16} />
              <span className="min-w-0 flex-1 truncate text-sm">{h}</span>
              <span className="text-sm text-mute tabular-nums">{n.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}

export function BoostSheet({
  open,
  onClose,
  tab,
  onZap,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  tab: Tab | undefined;
  onZap: () => void;
  onChanged: (unzapped?: string) => void;
}) {
  const sites = useBrowser((s) => s.sites);
  const settings = useBrowser((s) => s.settings);
  const setSite = useBrowser((s) => s.setSite);
  const host = hostOf(tab?.url);
  const site = (host && sites[host]) || {};
  const [css, setCss] = useState(site.css || "");
  useEffect(() => setCss(site.css || ""), [host, open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tab?.url) return null;
  const url = tab.url;
  const dark = site.dark ?? settings.darkPages;
  return (
    <Sheet open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-cobalt" /> Boost {host}</span>} height="tall" label="Boost this site">
      <p className="text-sm text-mute">Make this site yours. Changes apply every time you visit {host}.</p>
      <button
        type="button"
        onClick={onZap}
        className="mw-press mt-4 flex w-full items-center gap-3 rounded-2xl bg-ink p-4 text-left text-paper"
      >
        <Wand2 className="h-6 w-6 shrink-0" />
        <span>
          <span className="block font-medium">Zap elements</span>
          <span className="block text-xs opacity-70">Tap banners, popups or anything annoying to hide it for good.</span>
        </span>
      </button>

      <div className="mt-4 divide-y divide-rule/60">
        <div className="flex items-center gap-3 py-3">
          <Moon className="h-5 w-5 shrink-0" />
          <span className="flex-1">Dark page</span>
          <Toggle
            label="Dark page"
            checked={dark}
            onChange={(next) => {
              setSite(url, { dark: next });
              onChanged();
            }}
          />
        </div>
        <div className="flex items-center gap-3 py-3">
          <ShieldCheck className="h-5 w-5 shrink-0" />
          <span className="flex-1">Block ads</span>
          <Toggle
            label="Block ads on this site"
            checked={site.adblock ?? settings.adblock}
            onChange={(next) => {
              setSite(url, { adblock: next });
              onChanged();
            }}
          />
        </div>
      </div>

      {site.zapped?.length ? (
        <div className="mt-3">
          <p className="pb-1 text-xs font-medium tracking-wide text-mute uppercase">Hidden elements</p>
          {site.zapped.map((selector) => (
            <div key={selector} className="flex items-center gap-2 py-1.5">
              <Eye className="h-4 w-4 shrink-0 text-mute" />
              <code className="min-w-0 flex-1 truncate text-xs">{selector}</code>
              <button
                type="button"
                aria-label="Show this element again"
                onClick={() => {
                  setSite(url, { zapped: (site.zapped || []).filter((s) => s !== selector) });
                  onChanged(selector);
                }}
                className="mw-press flex h-9 w-9 items-center justify-center text-mute"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <label className="mt-4 block">
        <span className="text-xs font-medium tracking-wide text-mute uppercase">Custom CSS</span>
        <textarea
          value={css}
          onChange={(event) => setCss(event.target.value)}
          onBlur={() => {
            setSite(url, { css });
            onChanged();
          }}
          spellCheck={false}
          placeholder={"body { font-size: 18px; }\n.cookie-banner { display: none; }"}
          className="mt-1 h-32 w-full rounded-2xl bg-stone p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-cobalt"
        />
      </label>
      <div className="mt-3 flex justify-between pb-2">
        <button
          type="button"
          onClick={() => {
            setSite(url, null);
            setCss("");
            onChanged("*reset*");
            toast(`Reset ${host}`);
          }}
          className="mw-press h-11 rounded-full px-4 text-sm text-ember"
        >
          Reset site
        </button>
        <button
          type="button"
          onClick={() => {
            setSite(url, { css });
            onChanged();
            onClose();
          }}
          className="mw-press h-11 rounded-full bg-ink px-5 text-sm text-paper"
        >
          Apply
        </button>
      </div>
    </Sheet>
  );
}

const ARCHIVE_OPTIONS = [
  { value: 6, label: "6h" },
  { value: 24, label: "1 day" },
  { value: 72, label: "3 days" },
  { value: 168, label: "1 week" },
  { value: 100000, label: "Never" },
];

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useBrowser((s) => s.settings);
  const set = useBrowser((s) => s.setSettings);
  const clearHistory = useBrowser((s) => s.clearHistory);
  const clearAll = useBrowser((s) => s.clearAll);
  return (
    <Sheet open={open} onClose={onClose} title="Settings" height="tall" label="Settings">
      <Section title="Address bar">
        <Segmented
          label="Address bar position"
          value={settings.barPosition}
          onChange={(barPosition) => set({ barPosition })}
          options={[
            { value: "bottom", label: "Bottom" },
            { value: "top", label: "Top" },
          ]}
        />
      </Section>
      <Section title="Search engine">
        <Segmented<SearchEngine>
          label="Search engine"
          value={settings.searchEngine}
          onChange={(searchEngine) => set({ searchEngine })}
          options={(Object.keys(SEARCH_ENGINES) as SearchEngine[]).map((key) => ({ value: key, label: SEARCH_ENGINES[key].name }))}
        />
      </Section>
      <Section title="Pages">
        <SwitchRow label="Dark pages by default" detail="Darkens light sites. Change it per site in Boost." checked={settings.darkPages} onChange={(darkPages) => set({ darkPages })} />
        <SwitchRow label="Block ads and trackers" checked={settings.adblock} onChange={(adblock) => set({ adblock })} />
        <SwitchRow label="Haptic feedback" checked={settings.haptics} onChange={(haptics) => set({ haptics })} />
        <SwitchRow label="Open articles in Reader" detail="Jump straight to the clean reading view when a page is an article." checked={settings.autoReader} onChange={(autoReader) => set({ autoReader })} />
        <SwitchRow label="Data saver" detail="Images, videos and embeds load only when you tap them." checked={settings.dataSaver} onChange={(dataSaver) => set({ dataSaver })} />
      </Section>
      <Section title="Grok AI requests per day">
        <Segmented
          label="AI daily limit"
          value={settings.aiDailyLimit}
          onChange={(aiDailyLimit) => set({ aiDailyLimit })}
          options={[20, 50, 80, 150, 300].map((n) => ({ value: n, label: String(n) }))}
        />
        <p className="mt-1.5 text-xs text-mute">AI uses your Grok key's credits. This cap stops runaway use.</p>
      </Section>
      <Section title="Translate pages to">
        <select
          value={settings.translateTo}
          onChange={(event) => set({ translateTo: event.target.value })}
          className="h-11 w-full rounded-xl bg-stone px-3 text-[15px]"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </Section>
      <Section title="Archive unused tabs after">
        <Segmented label="Archive tabs after" value={settings.archiveHours} onChange={(archiveHours) => set({ archiveHours })} options={ARCHIVE_OPTIONS} />
      </Section>
      <Section title="Tabs kept awake">
        <Segmented
          label="Tabs kept in memory"
          value={settings.maxLiveTabs}
          onChange={(maxLiveTabs) => set({ maxLiveTabs })}
          options={[2, 3, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))}
        />
        <p className="mt-1.5 text-xs text-mute">Other tabs sleep to save memory and reload when you open them.</p>
      </Section>
      <Section title="Data">
        <Row icon={<Download className="h-4 w-4" />} title="Back up everything" detail="Tabs, spaces, bookmarks, notes, feeds, Skills, saved pages" onClick={exportBackup} />
        <label className="mw-press flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl py-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone text-ink">
            <Upload className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Restore from backup</span>
            <span className="block truncate text-xs text-mute">Pick a massweb-backup .json file</span>
          </span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => importBackup(event.target.files?.[0])} />
        </label>
        <Row
          icon={<History className="h-4 w-4" />}
          title="Clear history"
          onClick={() => {
            clearHistory();
            toast("History cleared");
          }}
        />
        <Row
          icon={<Trash2 className="h-4 w-4" />}
          title="Reset Mass Web"
          detail="Closes all tabs and clears history, bookmarks and site settings"
          danger
          onClick={() => {
            if (window.confirm("Reset Mass Web? This closes all tabs and clears history, bookmarks and site settings.")) {
              clearAll();
              toast("Mass Web was reset");
            }
          }}
        />
      </Section>
      <p className="py-4 text-center text-xs text-mute">Mass Web · your browser, built from scratch</p>
    </Sheet>
  );
}

export type LinkTarget = { href: string | null; text: string; image: string | null };

export type LinkAction = "tab" | "background" | "incognito" | "preview" | "split" | "copy" | "share" | "image" | "copy-image" | "summarize" | "download";

export function LinkMenu({
  target,
  onClose,
  onAction,
  aiOn,
}: {
  target: LinkTarget | null;
  onClose: () => void;
  onAction: (action: LinkAction, url: string) => void;
  aiOn: boolean;
}) {
  const href = target?.href ?? null;
  const image = target?.image ?? null;
  return (
    <Sheet
      open={!!target}
      onClose={onClose}
      title={<span className="block truncate text-base">{target?.text || (href ? displayText(href) : "Image")}</span>}
      label="Link options"
    >
      {href ? <p className="-mt-1 mb-2 truncate text-xs text-mute">{href}</p> : null}
      {href ? (
        <div className="pb-1">
          {aiOn ? (
            <Row icon={<Sparkles className="h-4 w-4" />} title="Summarize link" detail="Grok reads it so you don't have to" onClick={() => onAction("summarize", href)} />
          ) : null}
          <Row icon={<Eye className="h-4 w-4" />} title="Preview" detail="Peek without leaving this page" onClick={() => onAction("preview", href)} />
          <Row icon={<Plus className="h-4 w-4" />} title="Open in new tab" onClick={() => onAction("tab", href)} />
          <Row icon={<Plus className="h-4 w-4 opacity-50" />} title="Open in background tab" onClick={() => onAction("background", href)} />
          <Row icon={<Columns2 className="h-4 w-4" />} title="Open in split view" onClick={() => onAction("split", href)} />
          <Row icon={<VenetianMask className="h-4 w-4" />} title="Open in incognito tab" onClick={() => onAction("incognito", href)} />
          <Row icon={<Copy className="h-4 w-4" />} title="Copy link" onClick={() => onAction("copy", href)} />
          <Row icon={<Share2 className="h-4 w-4" />} title="Share link" onClick={() => onAction("share", href)} />
          <Row icon={<Download className="h-4 w-4" />} title="Download link" onClick={() => onAction("download", href)} />
        </div>
      ) : null}
      {image ? (
        <div className="border-t border-rule/60 pt-1 pb-1">
          <Row icon={<ImageIcon className="h-4 w-4" />} title="Open image in new tab" onClick={() => onAction("image", image)} />
          <Row icon={<Copy className="h-4 w-4" />} title="Copy image link" onClick={() => onAction("copy-image", image)} />
          <Row icon={<Download className="h-4 w-4" />} title="Download image" onClick={() => onAction("download", image)} />
        </div>
      ) : null}
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-1">
      <p className="pb-2 text-xs font-medium tracking-wide text-mute uppercase">{title}</p>
      {children}
    </div>
  );
}

function SwitchRow({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-[15px]">{label}</p>
        {detail ? <p className="text-xs text-mute">{detail}</p> : null}
      </div>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-11 items-center gap-2 rounded-xl bg-stone px-3">
      <Search className="h-4 w-4 shrink-0 text-mute" />
      <span className="sr-only">{placeholder}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-mute" />
    </label>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-12 text-center text-sm text-mute">{text}</p>;
}

async function exportBackup() {
  const state = useBrowser.getState();
  const saved = await listSaved();
  const data = {
    app: "massweb",
    version: 1,
    exportedAt: new Date().toISOString(),
    state: {
      spaces: state.spaces,
      tabs: state.tabs.filter((t) => !t.incognito).map(({ frame, nonce, fresh, postBody, loading, ...rest }) => rest),
      history: state.history,
      bookmarks: state.bookmarks,
      sites: state.sites,
      settings: state.settings,
      skills: state.skills,
      highlights: state.highlights,
      feeds: state.feeds,
    },
    saved,
  };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `massweb-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Backup saved to your downloads");
}

async function importBackup(file: File | undefined) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as { app?: string; state?: Record<string, unknown>; saved?: SavedArticle[] };
    if (data.app !== "massweb" || !data.state) throw new Error("bad file");
    useBrowser.getState().importData(data.state as Parameters<ReturnType<typeof useBrowser.getState>["importData"]>[0]);
    for (const article of data.saved || []) await saveArticle(article);
    toast("Backup restored");
  } catch {
    toast("That isn't a Mass Web backup file.");
  }
}
