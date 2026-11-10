import { ArrowUpLeft, Bookmark, Clock, Command, Copy, Globe, Layers, Search, Share2, Sparkles, X } from "lucide-react";
import { looksLikeQuestion } from "@/lib/browser/ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { SEARCH_ENGINES, destination, displayText, hostOf, looksLikeUrl } from "@/lib/browser/destination";
import { copyText, shareLink } from "@/lib/browser/device";
import { appPrefix } from "@/lib/browser/offline";
import { useBrowser } from "@/lib/browser/state";
import { toast } from "@/lib/browser/toast";
import { SiteIcon } from "./ui";

type Suggestion = {
  key: string;
  kind: "go" | "search" | "history" | "bookmark" | "tab" | "remote" | "ask" | "command";
  command?: string;
  title: string;
  detail?: string;
  url: string;
  fill?: string;
  tabId?: string;
};

function score(text: string, url: string, q: string): number {
  const query = q.toLowerCase();
  const host = hostOf(url).toLowerCase();
  const title = text.toLowerCase();
  if (host.startsWith(query)) return 100;
  if (host.includes(query)) return 70;
  if (title.startsWith(query)) return 60;
  if (title.includes(query)) return 40;
  if (url.toLowerCase().includes(query)) return 20;
  return 0;
}

export type PaletteCommand = { id: string; label: string; keywords: string };

export function Omnibox({
  open,
  initial,
  position,
  onClose,
  onSubmit,
  onSwitchTab,
  aiOn,
  onAsk,
  commands,
  onCommand,
  seed = "",
}: {
  open: boolean;
  initial: string;
  position: "bottom" | "top";
  onClose: () => void;
  onSubmit: (url: string) => void;
  onSwitchTab: (id: string) => void;
  aiOn: boolean;
  onAsk: (query: string) => void;
  commands: PaletteCommand[];
  onCommand: (id: string) => void;
  seed?: string;
}) {
  const [text, setText] = useState(initial);
  const [remote, setRemote] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useBrowser((s) => s.history);
  const bookmarks = useBrowser((s) => s.bookmarks);
  const tabs = useBrowser((s) => s.tabs);
  const engine = useBrowser((s) => s.settings.searchEngine);
  const incognito = useBrowser((s) => s.incognitoMode);

  useEffect(() => {
    if (!open) return;
    setText(seed || initial);
    setRemote([]);
    const timer = requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (seed) inputRef.current?.setSelectionRange(seed.length, seed.length);
      else inputRef.current?.select();
    });
    return () => cancelAnimationFrame(timer);
  }, [open, initial, seed]);

  const query = text.trim();
  const editingCurrent = query === initial && !!initial;

  useEffect(() => {
    if (!open || !query || editingCurrent || looksLikeUrl(query) || incognito || query.startsWith(">")) {
      setRemote([]);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${appPrefix()}/suggest?q=${encodeURIComponent(query)}`, { signal: ac.signal })
        .then((res) => res.json())
        .then((list: unknown) => {
          if (Array.isArray(list)) setRemote(list.filter((item): item is string => typeof item === "string"));
        })
        .catch(() => undefined);
    }, 110);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [open, query, editingCurrent, incognito]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!query || editingCurrent) {
      const seen = new Set<string>();
      return history
        .filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)))
        .slice(0, 6)
        .map((item) => ({ key: `h-${item.url}`, kind: "history" as const, title: item.title || hostOf(item.url), detail: displayText(item.url), url: item.url }));
    }
    const out: Suggestion[] = [];
    const lower = query.toLowerCase();
    if (query.startsWith(">")) {
      const needle = lower.slice(1).trim();
      return commands
        .filter((c) => !needle || c.label.toLowerCase().includes(needle) || c.keywords.includes(needle))
        .slice(0, 12)
        .map((c) => ({ key: `c-${c.id}`, kind: "command" as const, title: c.label, detail: "Command", url: "", command: c.id }));
    }
    const commandHits =
      lower.length >= 3 && !looksLikeUrl(query)
        ? commands.filter((c) => c.label.toLowerCase().startsWith(lower) || c.keywords.split(" ").some((k) => k.startsWith(lower))).slice(0, 2)
        : [];
    const ask: Suggestion | null =
      aiOn && !looksLikeUrl(query) && query.length > 2 ? { key: "ask", kind: "ask", title: query, detail: "Ask Grok · answer with sources", url: "" } : null;
    if (ask && looksLikeQuestion(query)) out.push(ask);
    if (looksLikeUrl(query)) {
      const url = destination(query) ?? query;
      out.push({ key: "go", kind: "go", title: url.replace(/^https:\/\//, ""), detail: "Go to address", url });
    }
    const local = new Map<string, Suggestion & { score: number }>();
    for (const tab of tabs) {
      if (!tab.url || tab.archivedAt) continue;
      const s = score(tab.title, tab.url, query);
      if (s) local.set(`t-${tab.id}`, { key: `t-${tab.id}`, kind: "tab", title: tab.title || hostOf(tab.url), detail: "Switch to tab", url: tab.url, tabId: tab.id, score: s + 15 });
    }
    for (const item of bookmarks) {
      const s = score(item.title, item.url, query);
      if (s && !local.has(item.url)) local.set(item.url, { key: `b-${item.url}`, kind: "bookmark", title: item.title || hostOf(item.url), detail: displayText(item.url), url: item.url, score: s + 10 });
    }
    for (const item of history.slice(0, 600)) {
      const s = score(item.title, item.url, query);
      if (s && !local.has(item.url)) local.set(item.url, { key: `h-${item.url}`, kind: "history", title: item.title || hostOf(item.url), detail: displayText(item.url), url: item.url, score: s });
      if (local.size > 30) break;
    }
    const ranked = [...local.values()].sort((a, b) => b.score - a.score).slice(0, 4);
    if (!looksLikeUrl(query)) {
      out.push({ key: "search", kind: "search", title: query, detail: `Search ${SEARCH_ENGINES[engine].name}`, url: SEARCH_ENGINES[engine].url(query) });
    }
    if (ask && !looksLikeQuestion(query)) out.push(ask);
    for (const c of commandHits) out.push({ key: `c-${c.id}`, kind: "command", title: c.label, detail: "Command", url: "", command: c.id });
    out.push(...ranked);
    for (const item of remote) {
      if (item.toLowerCase() === query.toLowerCase()) continue;
      out.push({ key: `r-${item}`, kind: "remote", title: item, url: SEARCH_ENGINES[engine].url(item), fill: item });
      if (out.length >= 10) break;
    }
    return out;
  }, [query, editingCurrent, history, bookmarks, tabs, remote, engine, aiOn, commands]);

  if (!open) return null;
  const bottom = position === "bottom";

  const submit = (raw: string) => {
    const url = destination(raw, engine);
    if (url) onSubmit(url);
  };

  const field = (
    <form
      className="shrink-0 px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(text);
      }}
    >
      <div className="flex h-12 items-center gap-2 rounded-full bg-stone px-4 ring-2 ring-cobalt/70">
        <Search className="h-4 w-4 shrink-0 text-mute" aria-hidden />
        <label className="sr-only" htmlFor="omnibox">
          Search or type web address
        </label>
        <input
          ref={inputRef}
          id="omnibox"
          name="address"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={aiOn ? "Search, ask Grok, or type > for commands" : "Search, type an address, or > for commands"}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          enterKeyHint="go"
          inputMode="url"
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-mute"
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
        />
        {text ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              setText("");
              inputRef.current?.focus();
            }}
            className="mw-press -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-mute"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </form>
  );

  const list = (
    <div className={`mw-noscroll flex min-h-0 flex-1 overflow-y-auto px-2 ${bottom ? "flex-col-reverse" : "flex-col"}`}>
      {suggestions.map((item) => (
        <div key={item.key} className="flex items-center">
          <button
            type="button"
            onClick={() =>
              item.kind === "ask" ? onAsk(item.title) : item.kind === "command" && item.command ? onCommand(item.command) : item.tabId ? onSwitchTab(item.tabId) : onSubmit(item.url)
            }
            className="mw-press flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 text-left active:bg-stone/70"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.kind === "ask" ? "bg-ink text-paper" : "bg-stone text-mute"}`}
            >
              {item.kind === "ask" ? (
                <Sparkles className="h-4 w-4" />
              ) : item.kind === "command" ? (
                <Command className="h-4 w-4" />
              ) : item.kind === "search" || item.kind === "remote" ? (
                <Search className="h-4 w-4" />
              ) : item.kind === "go" ? (
                <Globe className="h-4 w-4" />
              ) : item.kind === "tab" ? (
                <Layers className="h-4 w-4" />
              ) : item.kind === "bookmark" ? (
                <Bookmark className="h-4 w-4" />
              ) : (
                <SiteIcon url={item.url} size={18} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{item.title}</span>
              {item.detail ? (
                <span className="flex items-center gap-1 truncate text-xs text-mute">
                  {item.kind === "history" ? <Clock className="h-3 w-3" /> : null}
                  {item.detail}
                </span>
              ) : null}
            </span>
          </button>
          {item.kind !== "tab" && item.kind !== "command" && item.kind !== "ask" ? (
            <button
              type="button"
              aria-label={`Edit ${item.title}`}
              onClick={() => {
                setText(item.fill ?? item.url);
                inputRef.current?.focus();
              }}
              className={`mw-press flex h-12 w-11 shrink-0 items-center justify-center text-mute ${bottom ? "" : "rotate-90"}`}
            >
              <ArrowUpLeft className={`h-4 w-4 ${bottom ? "-scale-y-100" : ""}`} />
            </button>
          ) : null}
        </div>
      ))}
      {(!query || editingCurrent) && initial ? (
        <div className="flex gap-2 px-2 py-3">
          <button
            type="button"
            onClick={async () => {
              if (await copyText(initial)) toast("Link copied");
            }}
            className="mw-press flex h-10 items-center gap-2 rounded-full bg-stone px-4 text-sm"
          >
            <Copy className="h-4 w-4" /> Copy link
          </button>
          <button
            type="button"
            onClick={async () => {
              const result = await shareLink(initial, document.title);
              if (result === "copied") toast("Link copied");
            }}
            className="mw-press flex h-10 items-center gap-2 rounded-full bg-stone px-4 text-sm"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mw-scrim fixed inset-0 z-30 flex flex-col bg-paper" role="dialog" aria-label="Search or type web address">
      {bottom ? (
        <>
          <div className="flex shrink-0 justify-end px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <button type="button" onClick={onClose} className="mw-press h-10 rounded-full px-4 text-sm text-cobalt">
              Cancel
            </button>
          </div>
          {list}
          <div className="pb-[env(safe-area-inset-bottom)]">{field}</div>
        </>
      ) : (
        <>
          <div className="flex items-center pt-[env(safe-area-inset-top)]">
            <div className="min-w-0 flex-1">{field}</div>
            <button type="button" onClick={onClose} className="mw-press mr-2 h-10 rounded-full px-3 text-sm text-cobalt">
              Cancel
            </button>
          </div>
          {list}
        </>
      )}
    </div>
  );
}
