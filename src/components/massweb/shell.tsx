import { ChevronDown, ChevronUp, Copy, ExternalLink, Highlighter, Languages, RotateCw, Search, Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cleanUrl, destination, displayText, hostOf, unwrapRedirect } from "@/lib/browser/destination";
import { copyText, haptic, openExternally, reducedMotion, shareLink } from "@/lib/browser/device";
import { type Article, fetchArticle, saveArticle } from "@/lib/browser/offline";
import { type Tab, useBrowser } from "@/lib/browser/state";
import { toast } from "@/lib/browser/toast";
import { languageName, translateAll } from "@/lib/browser/translate";
import { aiStatus } from "@/lib/browser/ai";
import { AiPanel, type AiContext, AiUnavailable } from "./ai-panel";
import { AgentAccessSheet, FeedsSheet, NotesSheet, PageInfoSheet, QrSheet, downloadUrl } from "./power";
import { Bar } from "./bar";
import { NewTabPage } from "./new-tab";
import { Omnibox, type PaletteCommand } from "./omnibox";
import { type FrameInfo, PageFrame } from "./page-frame";
import {
  BookmarksSheet,
  BoostSheet,
  HistorySheet,
  LinkMenu,
  type LinkAction,
  type LinkTarget,
  type MenuAction,
  MenuSheet,
  SavedSheet,
  SettingsSheet,
  ShieldSheet,
} from "./panels";
import { ReaderView } from "./reader";
import { TabGrid } from "./tab-grid";
import { Row, Sheet, ToastView } from "./ui";

type Overlay =
  | "omnibox"
  | "tabs"
  | "menu"
  | "history"
  | "bookmarks"
  | "saved"
  | "shield"
  | "boost"
  | "settings"
  | "bar-menu"
  | "notes"
  | "feeds"
  | "info"
  | "ai-off"
  | "agents"
  | null;
type FrameMessage = {
  source?: string;
  type?: string;
  href?: string | null;
  body?: string;
  title?: string;
  text?: string;
  image?: string | null;
  icon?: string;
  themeColor?: string;
  y?: number;
  dy?: number;
  d?: number;
  count?: number;
  index?: number;
  selector?: string;
  texts?: string[];
  trackers?: string;
  feed?: string;
  id?: number;
};

const COMMANDS: PaletteCommand[] = [
  { id: "ask", label: "Ask Grok about this page", keywords: "ai grok summarize summary chat question" },
  { id: "new-tab", label: "New tab", keywords: "open tab" },
  { id: "incognito", label: "New incognito tab", keywords: "private secret" },
  { id: "reader", label: "Reader view", keywords: "read article clean" },
  { id: "listen", label: "Read aloud", keywords: "listen speak voice tts audio" },
  { id: "translate", label: "Translate page", keywords: "language malayalam hindi" },
  { id: "find", label: "Find in page", keywords: "search text" },
  { id: "dark", label: "Toggle dark page", keywords: "night theme black" },
  { id: "desktop", label: "Toggle desktop site", keywords: "pc computer full" },
  { id: "split", label: "Split view", keywords: "two side columns" },
  { id: "boost", label: "Boost this site", keywords: "zap css customize hide" },
  { id: "shield", label: "Shields & privacy", keywords: "ads trackers block privacy" },
  { id: "notes", label: "Notes & highlights", keywords: "highlight annotate" },
  { id: "feeds", label: "Live feeds", keywords: "rss follow news github" },
  { id: "bookmarks", label: "Bookmarks", keywords: "saved star" },
  { id: "history", label: "History", keywords: "recent visited" },
  { id: "saved", label: "Saved pages (offline)", keywords: "offline reading list" },
  { id: "save-offline", label: "Save page for offline", keywords: "download keep" },
  { id: "qr", label: "Show QR code", keywords: "share scan" },
  { id: "info", label: "Page info & view source", keywords: "source html developer code" },
  { id: "external", label: "Open in Chrome", keywords: "external app" },
  { id: "settings", label: "Settings", keywords: "preferences options" },
  { id: "agents", label: "Use Mass Web from AI agents (MCP / API)", keywords: "mcp api agent claude grok mnx developer" },
  { id: "bookmark", label: "Bookmark this page", keywords: "star save" },
  { id: "reload", label: "Reload page", keywords: "refresh" },
];

const PULL_TRIGGER = 110;

export function Browser() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return (
      <div className="grid h-dvh place-items-center bg-paper">
        <span className="font-serif text-3xl font-semibold tracking-tight text-ink">Mass Web</span>
      </div>
    );
  }
  return <Shell />;
}

function Shell() {
  const tabs = useBrowser((s) => s.tabs);
  const settings = useBrowser((s) => s.settings);
  const sites = useBrowser((s) => s.sites);
  const split = useBrowser((s) => s.split);
  const incognito = useBrowser((s) => s.incognitoMode);
  const activeSpace = useBrowser((s) => s.activeSpace);
  const active = useBrowser((s) => s.activeTab());
  const store = useBrowser.getState;

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [glance, setGlance] = useState<{ url: string; nonce: number; title: string } | null>(null);
  const [reader, setReader] = useState<{ tabId: string; url: string; saved?: Article | null; listen?: boolean } | null>(null);
  const [find, setFind] = useState<{ q: string; count: number; index: number } | null>(null);
  const [zapping, setZapping] = useState<string[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [pull, setPull] = useState(0);
  const [morphId, setMorphId] = useState<string | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [translated, setTranslated] = useState<Record<string, boolean>>({});
  const [aiOn, setAiOn] = useState(false);
  const [ai, setAi] = useState<AiContext | null>(null);
  const [selection, setSelection] = useState<{ key: string; text: string } | null>(null);
  const [selTranslation, setSelTranslation] = useState<{ text: string; out: string } | null>(null);
  const [qr, setQr] = useState<{ url: string; title: string } | null>(null);
  const [paletteSeed, setPaletteSeed] = useState("");
  const highlights = useBrowser((s) => s.highlights);
  const textWaiters = useRef(new Map<number, (v: { title: string; text: string } | null) => void>());

  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const lastNav = useRef(new Map<string, number>());
  const paneBox = useRef<HTMLDivElement>(null);
  const scrollAcc = useRef(0);
  const quietUntil = useRef(0);

  const pool = useMemo(
    () => tabs.filter((tab) => !tab.archivedAt && (incognito ? tab.incognito : !tab.incognito && tab.spaceId === activeSpace)),
    [tabs, incognito, activeSpace],
  );
  const splitTabs = split ? ([tabs.find((t) => t.id === split.a), tabs.find((t) => t.id === split.b)] as const) : null;
  const splitOn = !!(splitTabs && splitTabs[0] && splitTabs[1]);

  // ---------- setup: one tab minimum, archive stale tabs, incognito theme ----------
  useEffect(() => {
    const archived = store().archiveStale();
    if (archived) toast(`Archived ${archived} tab${archived === 1 ? "" : "s"} you haven't used in a while`);
    const onVisible = () => {
      if (document.visibilityState === "visible") store().archiveStale();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [store]);

  useEffect(() => {
    if (pool.length) return;
    // Re-check the live store: React may run this twice before the first new tab renders.
    const s = store();
    const hasTab = s.tabs.some((tab) => !tab.archivedAt && (s.incognitoMode ? tab.incognito : !tab.incognito && tab.spaceId === s.activeSpace));
    if (!hasTab) s.newTab(null);
  }, [pool.length, store]);

  useEffect(() => {
    document.documentElement.dataset.incognito = incognito ? "1" : "0";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--mw-paper").trim() || "#f5f0e6");
  }, [incognito]);

  // ---------- keep a few tabs awake; others sleep ----------
  useEffect(() => {
    if (!active) return;
    setLive((prev) => {
      const keep = [active.id, ...(splitOn && split ? [split.a, split.b] : []), ...prev];
      const unique = keep.filter((id, i) => keep.indexOf(id) === i && tabs.some((t) => t.id === id));
      return unique.slice(0, Math.max(settings.maxLiveTabs, splitOn ? 2 : 1));
    });
    setCollapsed(false);
    setFind(null);
    setSelection(null);
    // A tab that was hidden reports a scroll when it's shown again; don't let that collapse the bar.
    quietUntil.current = Date.now() + 700;
    scrollAcc.current = 0;
  }, [active?.id, splitOn, split?.a, split?.b, settings.maxLiveTabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- frame messaging ----------
  const register = useCallback((key: string, frame: HTMLIFrameElement | null) => {
    if (frame) frames.current.set(key, frame);
    else frames.current.delete(key);
  }, []);

  const sendTo = useCallback((key: string, msg: Record<string, unknown>) => {
    frames.current.get(key)?.contentWindow?.postMessage({ ...msg, source: "massweb-shell" }, "*");
  }, []);

  const siteConfig = useCallback(
    (url: string | null | undefined) => {
      const site = sites[hostOf(url)] || {};
      return {
        dark: site.dark ?? settings.darkPages,
        zoom: site.zoom ?? 1,
        css: site.css || "",
        zapped: site.zapped || [],
        adblock: site.adblock ?? settings.adblock,
        desktop: !!site.desktop,
        highlights: url ? (highlights[url] || []).map((h) => h.text) : [],
      };
    },
    [sites, settings.darkPages, settings.adblock, highlights],
  );

  const keyUrl = useCallback(
    (key: string) => (key === "glance" ? glance?.url : store().tabs.find((t) => t.id === key)?.url),
    [glance?.url, store],
  );

  const pushConfig = useCallback(() => {
    for (const key of frames.current.keys()) {
      const { dark, zoom, css, zapped, highlights: marks } = siteConfig(keyUrl(key));
      sendTo(key, { type: "config", dark, zoom, css, zapped, highlights: marks });
    }
  }, [keyUrl, sendTo, siteConfig]);

  useEffect(() => {
    pushConfig();
  }, [sites, settings.darkPages, highlights]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- AI availability, deep links (?open=… / shared text) ----------
  useEffect(() => {
    aiStatus().then(setAiOn);
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("open") || params.get("url") || params.get("text") || "";
      const found = raw.match(/https?:\/\/\S+/)?.[0] || (raw && !raw.includes(" ") ? raw : "");
      if (found) {
        const url = destination(found, store().settings.searchEngine);
        if (url) store().newTab(url);
        const clean = new URL(window.location.href);
        for (const key of ["open", "url", "text", "title"]) clean.searchParams.delete(key);
        history.replaceState(history.state, "", clean.pathname + clean.search + clean.hash);
      }
    } catch {
      /* ignore bad links */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ask a page frame for its visible text (used as the AI's context). */
  const getPageText = useCallback(
    (key: string) =>
      new Promise<{ title: string; text: string } | null>((resolve) => {
        if (!frames.current.get(key)) return resolve(null);
        const id = Math.floor(Math.random() * 1e9);
        const timer = setTimeout(() => {
          textWaiters.current.delete(id);
          resolve(null);
        }, 2500);
        textWaiters.current.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        sendTo(key, { type: "text-collect", id });
      }),
    [sendTo],
  );

  function openAi(context: AiContext) {
    if (!aiOn) {
      setOverlay("ai-off");
      return;
    }
    setOverlay(null);
    setLinkTarget(null);
    setAi(context);
  }

  const go = useCallback(
    (tabId: string, raw: string, postBody: string | null = null) => {
      const url = destination(raw, store().settings.searchEngine);
      if (!url) return;
      const now = Date.now();
      if (now - (lastNav.current.get(tabId) ?? 0) < 300) return;
      lastNav.current.set(tabId, now);
      store().navigate(tabId, url, { postBody });
      setTranslated((t) => ({ ...t, [tabId]: false }));
      if (reader?.tabId === tabId) setReader(null);
      ensureTrap();
    },
    [reader?.tabId, store],
  );

  const activeKey = active?.id ?? "";

  const handlers = useRef<(key: string, data: FrameMessage) => void>(() => undefined);
  handlers.current = (key, data) => {
    const s = store();
    const isGlance = key === "glance";
    const tab = isGlance ? undefined : s.tabs.find((t) => t.id === key);
    const isActive = key === activeKey;
    switch (data.type) {
      case "hello": {
        const { dark, zoom, css, zapped, highlights: marks } = siteConfig(keyUrl(key));
        sendTo(key, { type: "config", dark, zoom, css, zapped, highlights: marks });
        break;
      }
      case "page-text": {
        const done = data.id !== undefined ? textWaiters.current.get(data.id) : undefined;
        if (done) {
          textWaiters.current.delete(data.id!);
          done({ title: data.title || "", text: data.text || "" });
        }
        break;
      }
      case "selection":
        if (isGlance || !tab) break;
        setSelection(data.text ? { key, text: data.text } : null);
        break;
      case "download":
        if (data.href) downloadUrl(data.href);
        break;
      case "title":
      case "meta": {
        if (isGlance) {
          if (data.title) setGlance((g) => (g ? { ...g, title: data.title || g.title } : g));
          break;
        }
        if (!tab) break;
        const title = (data.title || "").trim();
        s.patchTab(tab.id, (current) => ({
          title: title || current.title,
          loading: false,
          ...(data.type === "meta"
            ? { icon: data.icon || current.icon, image: data.image || current.image, themeColor: data.themeColor || current.themeColor, feed: data.feed || current.feed }
            : {}),
        }));
        if (tab.url && !tab.incognito && title) s.remember(tab.url, title);
        break;
      }
      case "open":
        if (!data.href) break;
        if (isGlance) setGlance((g) => (g ? { url: cleanUrl(unwrapRedirect(data.href!)), nonce: g.nonce + 1, title: hostOf(data.href) } : g));
        else if (tab) go(tab.id, data.href);
        break;
      case "submit":
        if (!data.href) break;
        if (isGlance) setGlance((g) => (g ? { url: data.href!, nonce: g.nonce + 1, title: hostOf(data.href) } : g));
        else if (tab) go(tab.id, data.href, data.body ?? "");
        break;
      case "blocked": {
        if (!tab || !data.trackers) break;
        const count = data.trackers.split(",").reduce((sum, pair) => sum + (Number(pair.split(":")[1]) || 0), 0);
        s.patchTab(tab.id, (current) => {
          const merged = new Map<string, number>();
          for (const pair of [current.trackers, data.trackers].join(",").split(",")) {
            const [host, n] = pair.split(":");
            if (host) merged.set(host, (merged.get(host) || 0) + (Number(n) || 0));
          }
          return { blocked: current.blocked + count, trackers: [...merged].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h}:${n}`).join(",") };
        });
        if (!tab.incognito) s.countBlocked(data.trackers, count);
        break;
      }
      case "external":
        if (data.href) openExternally(data.href);
        break;
      case "scroll":
        if (!isActive || Date.now() < quietUntil.current) break;
        if ((data.y ?? 0) < 40) {
          scrollAcc.current = 0;
          setCollapsed(false);
          break;
        }
        scrollAcc.current = Math.sign(data.dy ?? 0) === Math.sign(scrollAcc.current) ? scrollAcc.current + (data.dy ?? 0) : data.dy ?? 0;
        if (scrollAcc.current > 48) setCollapsed(true);
        else if (scrollAcc.current < -36) setCollapsed(false);
        break;
      case "pull":
        if (isActive && !splitOn) setPull(data.d ?? 0);
        break;
      case "pullend":
        if (isActive && (data.d ?? 0) > PULL_TRIGGER && tab) {
          haptic(12);
          s.reload(tab.id);
        }
        setPull(0);
        break;
      case "linkmenu":
        haptic(14);
        setLinkTarget({ href: data.href ?? null, text: data.text || "", image: data.image ?? null });
        break;
      case "focus":
        if (splitOn && split && tab && (tab.id === split.a || tab.id === split.b)) {
          const focus = tab.id === split.a ? "a" : "b";
          if (split.focus !== focus) {
            s.setSplit({ ...split, focus });
            s.activate(tab.id);
          }
        }
        break;
      case "findresult":
        setFind((f) => (f ? { ...f, count: data.count ?? 0, index: data.index ?? -1 } : f));
        break;
      case "zapped":
        if (tab?.url && data.selector) {
          haptic(10);
          const current = s.site(tab.url).zapped || [];
          if (!current.includes(data.selector)) s.setSite(tab.url, { zapped: [...current, data.selector] });
          setZapping((z) => (z ? [...z, data.selector!] : z));
        }
        break;
      case "translate-texts": {
        const texts = data.texts || [];
        if (!texts.length) {
          toast("Nothing to translate on this page");
          break;
        }
        const to = s.settings.translateTo;
        translateAll(texts, to, (start, out) => sendTo(key, { type: "translate-apply", start, texts: out }))
          .then((from) => {
            if (tab) setTranslated((t) => ({ ...t, [tab.id]: true }));
            toast(`Translated${from ? ` from ${languageName(from)}` : ""} to ${languageName(to)}`, {
              label: "Show original",
              run: () => {
                sendTo(key, { type: "translate-revert" });
                if (tab) setTranslated((t) => ({ ...t, [tab.id]: false }));
              },
            });
          })
          .catch((err: unknown) => toast(err instanceof Error ? err.message : "Translation failed."));
        break;
      }
    }
  };

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as FrameMessage | null;
      if (!data || data.source !== "massweb") return;
      let key: string | null = null;
      for (const [k, frame] of frames.current) {
        if (frame.contentWindow === event.source) {
          key = k;
          break;
        }
      }
      if (key) handlers.current(key, data);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ---------- Android back gesture ----------
  const trapped = useRef(false);
  function ensureTrap() {
    if (trapped.current) return;
    try {
      history.pushState({ massweb: Date.now() }, "");
      trapped.current = true;
    } catch {
      /* ignore */
    }
  }
  const back = useRef<() => boolean>(() => false);
  back.current = () => {
    if (qr) return setQr(null), true;
    if (selTranslation) return setSelTranslation(null), true;
    if (ai) return setAi(null), true;
    if (linkTarget) return setLinkTarget(null), true;
    if (overlay) return setOverlay(null), true;
    if (glance) return setGlance(null), true;
    if (find) return closeFind(), true;
    if (zapping) return stopZap(), true;
    if (reader) return setReader(null), true;
    if (active && active.index > 0) return store().step(active.id, -1), true;
    return false;
  };
  useEffect(() => {
    ensureTrap();
    const onPop = () => {
      trapped.current = false;
      if (back.current()) ensureTrap();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);  
  useEffect(() => {
    if (overlay || glance || reader || find || linkTarget || ai || qr) ensureTrap();
  }, [overlay, glance, reader, find, linkTarget, ai, qr]);  

  // ---------- desktop keyboard shortcuts ----------
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event) => {
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (meta && key === "t") {
      event.preventDefault();
      newTab();
    } else if (meta && key === "w" && active) {
      event.preventDefault();
      closeTab(active);
    } else if (meta && key === "l") {
      event.preventDefault();
      setOverlay("omnibox");
    } else if (meta && key === "k") {
      event.preventDefault();
      setPaletteSeed(">");
      setOverlay("omnibox");
    } else if (meta && key === "j" && active?.url) {
      event.preventDefault();
      openAi({ kind: "page", url: active.url, title: active.title });
    } else if (meta && key === "r" && active) {
      event.preventDefault();
      store().reload(active.id);
    } else if (meta && key === "f" && active?.url) {
      event.preventDefault();
      setFind({ q: "", count: 0, index: -1 });
    } else if (event.altKey && event.key === "ArrowLeft" && active) {
      event.preventDefault();
      store().step(active.id, -1);
    } else if (event.altKey && event.key === "ArrowRight" && active) {
      event.preventDefault();
      store().step(active.id, 1);
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- actions ----------
  function newTab(url: string | null = null) {
    store().newTab(url);
    setOverlay(url ? null : "omnibox");
    setReader(null);
  }

  function closeTab(tab: Tab) {
    const removed = store().closeTab(tab.id);
    if (removed) toast(`Closed ${removed.title || "tab"}`, { label: "Undo", run: () => useBrowser.getState().restoreTab(removed) });
  }

  function closeFind() {
    if (active) sendTo(active.id, { type: "findclear" });
    setFind(null);
    setCollapsed(false);
  }

  function startZap() {
    if (!active) return;
    setOverlay(null);
    setZapping([]);
    sendTo(active.id, { type: "zap", on: true });
  }

  function stopZap() {
    if (active) sendTo(active.id, { type: "zap", on: false });
    if (zapping?.length) toast(`Hid ${zapping.length} element${zapping.length === 1 ? "" : "s"} on ${hostOf(active?.url)}`);
    setZapping(null);
  }

  function undoZap() {
    if (!active?.url || !zapping?.length) return;
    const last = zapping[zapping.length - 1];
    const site = store().site(active.url);
    store().setSite(active.url, { zapped: (site.zapped || []).filter((s) => s !== last) });
    sendTo(active.id, { type: "unzap", selector: last });
    setZapping(zapping.slice(0, -1));
  }

  function pickTab(id: string, el: HTMLElement | null) {
    const s = store();
    if (split && id !== split.a && id !== split.b) s.setSplit(null);
    const commit = () => {
      s.activate(id);
      setOverlay(null);
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (el && doc.startViewTransition && !reducedMotion()) {
      flushSync(() => setMorphId(id));
      doc.startViewTransition(() => flushSync(commit));
      setTimeout(() => setMorphId(null), 400);
    } else commit();
  }

  function openTabs() {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !reducedMotion() && active?.frame) doc.startViewTransition(() => flushSync(() => setOverlay("tabs")));
    else setOverlay("tabs");
  }

  function toggleSplit(partnerId?: string) {
    const s = store();
    if (!active) return;
    if (split && !partnerId) {
      s.setSplit(null);
      return;
    }
    let partner = partnerId;
    if (!partner) {
      partner = pool
        .filter((t) => t.id !== active.id)
        .sort((a, b) => b.lastActive - a.lastActive)[0]?.id;
    }
    if (!partner) partner = s.newTab(null, { background: true });
    s.setSplit({ a: active.id, b: partner, ratio: 0.5, focus: "a" });
    haptic();
  }

  async function saveOffline(url: string) {
    toast("Saving for offline…");
    try {
      const article = await fetchArticle(url);
      await saveArticle(article);
      toast("Saved for offline reading");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save this page.");
    }
  }

  function runMenu(action: MenuAction) {
    const s = store();
    const tab = active;
    const url = tab?.url ?? null;
    const keepOpen: MenuAction[] = [];
    if (!keepOpen.includes(action)) setOverlay(null);
    switch (action) {
      case "back":
        if (tab) s.step(tab.id, -1);
        break;
      case "forward":
        if (tab) s.step(tab.id, 1);
        break;
      case "reload":
        if (tab) s.reload(tab.id);
        break;
      case "bookmark":
        if (url && tab) {
          const had = s.bookmarks.some((b) => b.url === url);
          s.toggleBookmark(url, tab.title);
          toast(had ? "Bookmark removed" : "Bookmarked");
        }
        break;
      case "share":
        if (url && tab) shareLink(url, tab.title).then((r) => r === "copied" && toast("Link copied"));
        break;
      case "copy":
        if (url) copyText(url).then((ok) => ok && toast("Link copied"));
        break;
      case "new-tab":
        newTab();
        break;
      case "incognito":
        s.newTab(null, { incognito: true });
        setOverlay("omnibox");
        break;
      case "bookmarks":
      case "history":
      case "saved":
      case "shield":
      case "boost":
      case "settings":
        setOverlay(action);
        break;
      case "reader":
        if (tab && url) setReader({ tabId: tab.id, url });
        break;
      case "listen":
        if (tab && url) setReader({ tabId: tab.id, url, listen: true });
        break;
      case "translate":
        if (!tab) break;
        if (translated[tab.id]) {
          sendTo(tab.id, { type: "translate-revert" });
          setTranslated((t) => ({ ...t, [tab.id]: false }));
        } else {
          toast(`Translating to ${languageName(s.settings.translateTo)}…`);
          sendTo(tab.id, { type: "translate-collect" });
        }
        break;
      case "find":
        setFind({ q: "", count: 0, index: -1 });
        break;
      case "dark":
        if (url) {
          const next = !siteConfig(url).dark;
          s.setSite(url, { dark: next });
          toast(next ? `Dark pages on for ${hostOf(url)}` : `Dark pages off for ${hostOf(url)}`);
        }
        break;
      case "split":
        toggleSplit();
        break;
      case "save-offline":
        if (url) saveOffline(url);
        break;
      case "external":
        if (url) openExternally(url);
        break;
      case "ask":
        if (tab && url) openAi({ kind: "page", url, title: tab.title });
        break;
      case "notes":
      case "feeds":
      case "info":
      case "agents":
        setOverlay(action);
        break;
      case "qr":
        if (url && tab) setQr({ url, title: tab.title });
        break;
      case "desktop":
        if (url && tab) {
          const next = !siteConfig(url).desktop;
          s.setSite(url, { desktop: next });
          toast(next ? `Desktop site on for ${hostOf(url)}` : `Mobile site for ${hostOf(url)}`);
        }
        break;
    }
  }

  function runCommand(id: string) {
    setOverlay(null);
    setPaletteSeed("");
    runMenu(id as MenuAction);
  }

  function selectionAction(action: "explain" | "translate" | "highlight" | "copy" | "search") {
    if (!selection || !active) return;
    const text = selection.text;
    sendTo(selection.key, { type: "clearselection" });
    setSelection(null);
    if (action === "explain" && active.url) openAi({ kind: "selection", url: active.url, title: active.title, selection: text, prompt: "Explain this passage in plain words, using the page for context." });
    else if (action === "copy") copyText(text).then((ok) => ok && toast("Copied"));
    else if (action === "search") newTab(destination(text, store().settings.searchEngine));
    else if (action === "highlight" && active.url) {
      store().addHighlight(active.url, active.title, text);
      haptic(10);
      toast("Highlighted", { label: "Notes", run: () => setOverlay("notes") });
    } else if (action === "translate") {
      setSelTranslation({ text, out: "" });
      translateAll([text], store().settings.translateTo, (_start, out) => setSelTranslation({ text, out: out[0] || "" })).catch((err: unknown) => {
        setSelTranslation(null);
        toast(err instanceof Error ? err.message : "Translation failed.");
      });
    }
  }

  function linkAction(action: LinkAction, url: string) {
    const s = store();
    setLinkTarget(null);
    switch (action) {
      case "tab":
        s.newTab(url);
        break;
      case "background": {
        const id = s.newTab(url, { background: true });
        toast("Opened in background tab", { label: "Switch", run: () => useBrowser.getState().activate(id) });
        break;
      }
      case "incognito":
        s.newTab(url, { incognito: true });
        break;
      case "preview":
        setGlance({ url, nonce: 0, title: hostOf(url) });
        break;
      case "split": {
        if (!active) break;
        const id = s.newTab(url, { background: true });
        s.setSplit({ a: active.id, b: id, ratio: 0.5, focus: "b" });
        break;
      }
      case "copy":
      case "copy-image":
        copyText(url).then((ok) => ok && toast("Link copied"));
        break;
      case "share":
        shareLink(url, "").then((r) => r === "copied" && toast("Link copied"));
        break;
      case "image":
        s.newTab(url, { background: true });
        toast("Image opened in background tab");
        break;
      case "summarize":
        openAi({ kind: "link", url, title: hostOf(url), prompt: "Summarize this page in 5 bullet points. Is it worth reading?" });
        break;
      case "download":
        downloadUrl(url);
        break;
    }
  }

  function onInfo(tab: Tab, info: FrameInfo) {
    const s = store();
    const patch: Partial<Tab> = { readable: info.readable, blocked: info.blocked, trackers: info.trackers };
    if (info.finalUrl && info.finalUrl !== tab.url) {
      patch.url = info.finalUrl;
      const fresh = s.tabs.find((t) => t.id === tab.id);
      if (fresh) patch.history = fresh.history.map((u, i) => (i === fresh.index ? info.finalUrl : u));
    }
    s.patchTab(tab.id, patch);
    if (!tab.incognito) s.countBlocked(info.trackers, info.blocked);
    if (info.readable && s.settings.autoReader && !reader && tab.id === active?.id) {
      setReader({ tabId: tab.id, url: info.finalUrl || tab.frame || "" });
    }
  }

  // ---------- render ----------
  const position = settings.barPosition;
  const barNode = find ? (
    <FindBar
      position={position}
      find={find}
      onChange={(q) => {
        setFind({ q, count: 0, index: -1 });
        if (active) sendTo(active.id, { type: "find", q, step: 0 });
      }}
      onStep={(step) => active && find.q && sendTo(active.id, { type: "find", q: find.q, step })}
      onClose={closeFind}
    />
  ) : (
    <Bar
      tab={active}
      tabCount={pool.length}
      position={position}
      collapsed={collapsed && !overlay}
      incognito={incognito}
      canBack={!!active && active.index > 0}
      onBack={() => active && store().step(active.id, -1)}
      onOpenOmnibox={() => setOverlay("omnibox")}
      onSwipeTab={(dir) => {
        if (!active) return false;
        const index = pool.findIndex((t) => t.id === active.id);
        const next = pool[index + dir];
        if (!next) return false;
        if (split && next.id !== split.a && next.id !== split.b) store().setSplit(null);
        store().activate(next.id);
        return true;
      }}
      onOpenTabs={openTabs}
      onMenu={() => setOverlay("menu")}
      onLongPress={() => setOverlay("bar-menu")}
      onExpand={() => setCollapsed(false)}
      onReader={() => active?.url && setReader({ tabId: active.id, url: active.url })}
      onShield={() => setOverlay("shield")}
    />
  );

  const visibleIds = splitOn && split ? [split.a, split.b] : active ? [active.id] : [];
  const rendered = tabs.filter((tab) => visibleIds.includes(tab.id) || (live.includes(tab.id) && tab.frame));

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-paper text-ink">
      {position === "top" ? barNode : null}

      <div ref={paneBox} className={`relative flex min-h-0 flex-1 ${splitOn ? "flex-col md:flex-row" : ""}`} style={{ viewTransitionName: overlay === "tabs" ? undefined : "mw-morph" }}>
        {rendered.map((tab) => {
          const role = splitOn && split ? (tab.id === split.a ? "a" : tab.id === split.b ? "b" : "hidden") : tab.id === active?.id ? "single" : "hidden";
          const ratio = split?.ratio ?? 0.5;
          const focused = splitOn && split && ((role === "a" && split.focus === "a") || (role === "b" && split.focus === "b"));
          const cfg = siteConfig(tab.url ?? tab.frame);
          return (
            <div
              key={tab.id}
              className={`relative min-h-0 min-w-0 overflow-hidden ${role === "hidden" ? "hidden" : ""} ${role === "single" ? "flex-1" : ""} ${
                splitOn && role !== "hidden" ? `rounded-xl ${focused ? "ring-2 ring-cobalt ring-inset" : ""}` : ""
              }`}
              style={role === "a" ? { order: 0, flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 } : role === "b" ? { order: 2, flex: 1 } : undefined}
              onPointerDownCapture={() => {
                if (splitOn && split && (role === "a" || role === "b") && split.focus !== role) {
                  store().setSplit({ ...split, focus: role });
                  store().activate(tab.id);
                }
              }}
            >
              {tab.frame && (live.includes(tab.id) || visibleIds.includes(tab.id)) ? (
                <PageFrame
                  frameKey={tab.id}
                  url={tab.frame}
                  nonce={tab.nonce}
                  fresh={tab.fresh}
                  postBody={tab.postBody}
                  dark={cfg.dark}
                  adblock={cfg.adblock}
                  desktop={cfg.desktop}
                  lite={settings.dataSaver}
                  title={tab.title}
                  register={register}
                  onInfo={(info) => onInfo(tab, info)}
                  onLoaded={() => store().patchTab(tab.id, { loading: false })}
                  onExternal={() => tab.url && openExternally(tab.url)}
                  onRecover={() => store().reload(tab.id)}
                />
              ) : (
                <NewTabPage
                  incognito={tab.incognito}
                  onSearch={() => {
                    store().activate(tab.id);
                    setOverlay("omnibox");
                  }}
                  onOpen={(url) => go(tab.id, url)}
                  onOpenSaved={(article) => setReader({ tabId: tab.id, url: article.url, saved: article })}
                  onShield={() => setOverlay("shield")}
                />
              )}
              {reader && reader.tabId === tab.id ? (
                <ReaderView
                  key={`${reader.url}-${reader.listen ? 1 : 0}`}
                  url={reader.url}
                  saved={reader.saved}
                  autoListen={reader.listen}
                  onClose={() => setReader(null)}
                  onOpenLink={(href) => {
                    setReader(null);
                    go(tab.id, href);
                  }}
                />
              ) : null}
            </div>
          );
        })}
        {!rendered.length ? <div className="flex-1" /> : null}

        {splitOn && split ? (
          <SplitDivider
            onDrag={(clientX, clientY) => {
              const box = paneBox.current?.getBoundingClientRect();
              if (!box) return;
              const vertical = window.matchMedia("(min-width: 768px)").matches;
              const ratio = vertical ? (clientX - box.left) / box.width : (clientY - box.top) / box.height;
              store().setSplit({ ...split, ratio: Math.min(0.8, Math.max(0.2, ratio)) });
            }}
            onSwap={() => store().setSplit({ ...split, a: split.b, b: split.a, focus: split.focus === "a" ? "b" : "a" })}
            onClose={() => store().setSplit(null)}
          />
        ) : null}

        {pull > 8 ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lift ${pull > PULL_TRIGGER ? "bg-cobalt text-white" : "bg-card text-ink"}`}
              style={{ transform: `translateY(${Math.min(pull, 160) * 0.55 - 12}px) rotate(${pull * 2.2}deg)`, opacity: Math.min(1, pull / 70) }}
            >
              <RotateCw className="h-5 w-5" />
            </div>
          </div>
        ) : null}

        {selection && !zapping ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
            <div className="mw-rise pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-ink p-1 text-sm text-paper shadow-lift" role="toolbar" aria-label="Selected text actions">
              {aiOn ? (
                <button type="button" onClick={() => selectionAction("explain")} className="mw-press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-paper/15 px-3.5 font-medium">
                  <Sparkles className="h-4 w-4" /> Explain
                </button>
              ) : null}
              <button type="button" onClick={() => selectionAction("highlight")} className="mw-press flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3">
                <Highlighter className="h-4 w-4" /> Highlight
              </button>
              <button type="button" onClick={() => selectionAction("translate")} aria-label="Translate selection" className="mw-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <Languages className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => selectionAction("search")} aria-label="Search for selection" className="mw-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <Search className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => selectionAction("copy")} aria-label="Copy selection" className="mw-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        {zapping ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
            <div className="mw-pop pointer-events-auto flex items-center gap-1 rounded-full bg-ink py-1.5 pr-1.5 pl-4 text-sm text-paper shadow-lift">
              <span className="mr-1">Tap anything to hide it</span>
              <button type="button" aria-label="Undo" disabled={!zapping.length} onClick={undoZap} className="mw-press flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40">
                <Undo2 className="h-4 w-4" />
              </button>
              <button type="button" onClick={stopZap} className="mw-press h-9 rounded-full bg-paper px-4 font-medium text-ink">
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {position === "bottom" ? barNode : null}

      <Omnibox
        open={overlay === "omnibox"}
        initial={active?.url ?? ""}
        position={position}
        onClose={() => {
          setOverlay(null);
          setPaletteSeed("");
        }}
        onSubmit={(url) => {
          setPaletteSeed("");
          setOverlay(null);
          if (active) go(active.id, url);
          else store().newTab(url);
        }}
        onSwitchTab={(id) => pickTab(id, null)}
        aiOn={aiOn}
        onAsk={(query) => openAi({ kind: "search", query })}
        commands={COMMANDS}
        onCommand={runCommand}
        seed={paletteSeed}
      />

      <TabGrid
        open={overlay === "tabs"}
        morphId={morphId}
        onClose={() => setOverlay(null)}
        onPick={pickTab}
        onNewTab={() => newTab()}
        onSplitWith={(id) => {
          setOverlay(null);
          toggleSplit(id);
        }}
        aiOn={aiOn}
      />

      <MenuSheet
        open={overlay === "menu"}
        onClose={() => setOverlay(null)}
        tab={active}
        zoom={siteConfig(active?.url).zoom}
        onZoom={(zoom) => active?.url && store().setSite(active.url, { zoom })}
        dark={siteConfig(active?.url).dark}
        desktop={siteConfig(active?.url).desktop}
        split={!!split}
        aiOn={aiOn}
        onAction={runMenu}
      />
      <HistorySheet open={overlay === "history"} onClose={() => setOverlay(null)} onOpen={(url) => (setOverlay(null), active ? go(active.id, url) : store().newTab(url))} />
      <BookmarksSheet open={overlay === "bookmarks"} onClose={() => setOverlay(null)} onOpen={(url) => (setOverlay(null), active ? go(active.id, url) : store().newTab(url))} />
      <SavedSheet
        open={overlay === "saved"}
        onClose={() => setOverlay(null)}
        onOpen={(article) => {
          setOverlay(null);
          if (active) setReader({ tabId: active.id, url: article.url, saved: article });
        }}
      />
      <ShieldSheet open={overlay === "shield"} onClose={() => setOverlay(null)} tab={active} onChanged={() => active && store().reload(active.id)} />
      <BoostSheet
        open={overlay === "boost"}
        onClose={() => setOverlay(null)}
        tab={active}
        onZap={startZap}
        onChanged={(unzapped) => {
          if (unzapped === "*reset*") {
            if (active) store().reload(active.id);
            return;
          }
          if (unzapped && active) sendTo(active.id, { type: "unzap", selector: unzapped });
          const site = active?.url ? store().site(active.url) : {};
          if (active && (site.adblock ?? settings.adblock) !== siteConfig(active.frame).adblock) store().reload(active.id);
        }}
      />
      <SettingsSheet open={overlay === "settings"} onClose={() => setOverlay(null)} onAgents={() => setOverlay("agents")} />
      <AgentAccessSheet open={overlay === "agents"} onClose={() => setOverlay(null)} />
      <LinkMenu target={linkTarget} onClose={() => setLinkTarget(null)} onAction={linkAction} aiOn={aiOn} />
      <NotesSheet open={overlay === "notes"} onClose={() => setOverlay(null)} onOpen={(url) => (setOverlay(null), active ? go(active.id, url) : store().newTab(url))} />
      <FeedsSheet open={overlay === "feeds"} onClose={() => setOverlay(null)} onOpen={(url) => (setOverlay(null), active ? go(active.id, url) : store().newTab(url))} currentTab={active} />
      <PageInfoSheet open={overlay === "info"} onClose={() => setOverlay(null)} tab={active} onDownload={downloadUrl} />
      <QrSheet url={qr?.url ?? null} title={qr?.title ?? ""} onClose={() => setQr(null)} />
      <AiUnavailable open={overlay === "ai-off"} onClose={() => setOverlay(null)} />
      <AiPanel
        context={ai}
        onClose={() => setAi(null)}
        getPageText={() => (active ? getPageText(active.id) : Promise.resolve(null))}
        onOpenUrl={(url) => {
          setAi(null);
          store().newTab(url);
        }}
      />
      <Sheet open={!!selTranslation} onClose={() => setSelTranslation(null)} title={`Translation · ${languageName(settings.translateTo)}`} label="Translation">
        {selTranslation ? (
          <div className="pb-4">
            <p className="text-sm text-mute">{selTranslation.text}</p>
            <p className="mt-3 text-lg leading-snug">{selTranslation.out || <span className="text-mute">Translating…</span>}</p>
            {selTranslation.out ? (
              <button
                type="button"
                onClick={async () => (await copyText(selTranslation.out)) && toast("Copied")}
                className="mw-press mt-4 flex h-10 items-center gap-2 rounded-full bg-stone px-4 text-sm"
              >
                <Copy className="h-4 w-4" /> Copy translation
              </button>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet open={overlay === "bar-menu"} onClose={() => setOverlay(null)} label="Address bar options">
        <div className="pb-2">
          <Row
            icon={position === "bottom" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            title={position === "bottom" ? "Move address bar to top" : "Move address bar to bottom"}
            onClick={() => {
              store().setSettings({ barPosition: position === "bottom" ? "top" : "bottom" });
              setOverlay(null);
              haptic();
            }}
          />
          {active?.url ? (
            <>
              <Row icon={<ExternalLink className="h-4 w-4" />} title="Copy link" detail={displayText(active.url)} onClick={() => runMenu("copy")} />
              <Row icon={<ExternalLink className="h-4 w-4" />} title="Share" onClick={() => runMenu("share")} />
            </>
          ) : null}
          <Row
            icon={<ExternalLink className="h-4 w-4" />}
            title="Paste and go"
            onClick={async () => {
              setOverlay(null);
              try {
                const text = await navigator.clipboard.readText();
                if (text.trim() && active) go(active.id, text.trim());
              } catch {
                toast("Couldn't read the clipboard");
              }
            }}
          />
        </div>
      </Sheet>

      <Sheet
        open={!!glance}
        onClose={() => setGlance(null)}
        height="full"
        label="Link preview"
        title={<span className="block truncate text-base">{glance?.title || hostOf(glance?.url)}</span>}
        actions={
          glance ? (
            <button
              type="button"
              onClick={() => {
                const url = glance.url;
                setGlance(null);
                store().newTab(url);
              }}
              className="mw-press h-9 shrink-0 rounded-full bg-ink px-4 text-sm text-paper"
            >
              Open tab
            </button>
          ) : null
        }
      >
        {glance ? (
          <div className="-mx-5 h-[calc(94dvh-84px)] overflow-hidden">
            <PageFrame
              frameKey="glance"
              url={glance.url}
              nonce={glance.nonce}
              fresh={false}
              postBody={null}
              dark={siteConfig(glance.url).dark}
              adblock={siteConfig(glance.url).adblock}
              title={glance.title}
              register={register}
              onInfo={(info) => setGlance((g) => (g ? { ...g, url: info.finalUrl || g.url } : g))}
              onLoaded={() => undefined}
              onExternal={() => openExternally(glance.url)}
              onRecover={() => setGlance((g) => (g ? { ...g, nonce: g.nonce + 1 } : g))}
            />
          </div>
        ) : null}
      </Sheet>

      <ToastView offset={overlay === "tabs" ? 96 : position === "bottom" ? (collapsed ? 48 : 76) : 20} />
    </div>
  );
}

function FindBar({
  position,
  find,
  onChange,
  onStep,
  onClose,
}: {
  position: "bottom" | "top";
  find: { q: string; count: number; index: number };
  onChange: (q: string) => void;
  onStep: (step: 1 | -1) => void;
  onClose: () => void;
}) {
  return (
    <div className={`z-20 bg-paper ${position === "bottom" ? "pb-[env(safe-area-inset-bottom)] shadow-[var(--mw-bar-shadow)]" : "border-b border-rule pt-[env(safe-area-inset-top)]"}`}>
      <form
        className="mx-auto flex h-[60px] max-w-3xl items-center gap-1 px-2"
        onSubmit={(event) => {
          event.preventDefault();
          onStep(1);
        }}
      >
        <label className="flex h-11 min-w-0 flex-1 items-center rounded-full bg-stone px-4">
          <span className="sr-only">Find in page</span>
          <input
            autoFocus
            value={find.q}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Find in page"
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mute"
          />
          <span className="shrink-0 text-xs text-mute tabular-nums">{find.q ? (find.count ? `${find.index + 1}/${find.count}` : "0/0") : ""}</span>
        </label>
        <button type="button" aria-label="Previous match" onClick={() => onStep(-1)} className="mw-press flex h-11 w-10 items-center justify-center">
          <ChevronUp className="h-5 w-5" />
        </button>
        <button type="button" aria-label="Next match" onClick={() => onStep(1)} className="mw-press flex h-11 w-10 items-center justify-center">
          <ChevronDown className="h-5 w-5" />
        </button>
        <button type="button" aria-label="Close find" onClick={onClose} className="mw-press flex h-11 w-10 items-center justify-center">
          <X className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}

function SplitDivider({ onDrag, onSwap, onClose }: { onDrag: (x: number, y: number) => void; onSwap: () => void; onClose: () => void }) {
  const dragging = useRef(false);
  return (
    <div
      style={{ order: 1 }}
      className="relative z-10 flex h-5 shrink-0 touch-none items-center justify-center gap-2 bg-paper md:h-auto md:w-5 md:flex-col"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => dragging.current && onDrag(event.clientX, event.clientY)}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <button type="button" aria-label="Swap panes" onClick={onSwap} className="mw-press flex h-5 items-center rounded-full px-2 text-[10px] text-mute">
        ⇅
      </button>
      <span className="h-1.5 w-12 rounded-full bg-rule md:h-12 md:w-1.5" aria-hidden />
      <button type="button" aria-label="Close split view" onClick={onClose} className="mw-press flex h-5 w-6 items-center justify-center text-mute">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
