import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SearchEngine } from "@/lib/browser/destination";
import { hostOf } from "@/lib/browser/destination";

export type Tab = {
  id: string;
  spaceId: string;
  incognito: boolean;
  url: string | null;
  title: string;
  icon: string;
  image: string;
  themeColor: string;
  history: string[];
  index: number;
  lastActive: number;
  archivedAt: number | null;
  readable: boolean;
  blocked: number;
  trackers: string;
  feed?: string;
  // Runtime only (not persisted):
  frame: string | null;
  nonce: number;
  fresh: boolean;
  postBody: string | null;
  loading: boolean;
};

export type Space = { id: string; name: string; emoji: string };
export type Site = { url: string; title: string; at: number };
export type SiteSettings = { zoom?: number; dark?: boolean; adblock?: boolean; css?: string; zapped?: string[]; desktop?: boolean };
export type Highlight = { id: string; text: string; note: string; at: number; title: string };
export type Feed = { url: string; title: string; siteUrl: string; lastSeen: number; added: number };
export type Split = { a: string; b: string; ratio: number; focus: "a" | "b" } | null;

export type Settings = {
  barPosition: "bottom" | "top";
  searchEngine: SearchEngine;
  darkPages: boolean;
  adblock: boolean;
  archiveHours: number;
  translateTo: string;
  readerTheme: "paper" | "white" | "night";
  readerSize: number;
  readerFont: "serif" | "sans";
  haptics: boolean;
  voiceRate: number;
  maxLiveTabs: number;
  autoReader: boolean;
  dataSaver: boolean;
};

type Stats = { total: number; byHost: Record<string, number>; byDay: Record<string, number> };

type State = {
  tabs: Tab[];
  spaces: Space[];
  activeSpace: string;
  activeBySpace: Record<string, string>;
  incognitoMode: boolean;
  split: Split;
  history: Site[];
  bookmarks: Site[];
  sites: Record<string, SiteSettings>;
  settings: Settings;
  stats: Stats;
  highlights: Record<string, Highlight[]>;
  feeds: Feed[];
};

type Actions = {
  activeTab: () => Tab | undefined;
  newTab: (url?: string | null, opts?: { background?: boolean; incognito?: boolean }) => string;
  closeTab: (id: string) => Tab | undefined;
  restoreTab: (tab: Tab) => void;
  activate: (id: string) => void;
  navigate: (id: string, url: string, opts?: { postBody?: string | null; replace?: boolean }) => void;
  step: (id: string, dir: -1 | 1) => boolean;
  reload: (id: string) => void;
  patchTab: (id: string, patch: Partial<Tab> | ((tab: Tab) => Partial<Tab>)) => void;
  setIncognito: (on: boolean) => void;
  addSpace: (name: string, emoji: string) => string;
  renameSpace: (id: string, name: string, emoji: string) => void;
  removeSpace: (id: string) => void;
  switchSpace: (id: string) => void;
  moveTab: (id: string, spaceId: string) => void;
  archiveStale: () => number;
  unarchive: (id: string) => void;
  setSplit: (split: Split) => void;
  remember: (url: string, title: string) => void;
  forget: (url: string, at?: number) => void;
  clearHistory: () => void;
  toggleBookmark: (url: string, title: string) => void;
  site: (url: string | null | undefined) => SiteSettings;
  setSite: (url: string, patch: Partial<SiteSettings> | null) => void;
  setSettings: (patch: Partial<Settings>) => void;
  countBlocked: (trackers: string, count: number) => void;
  clearAll: () => void;
  addHighlight: (url: string, title: string, text: string) => string;
  noteHighlight: (url: string, id: string, note: string) => void;
  removeHighlight: (url: string, id: string) => void;
  followFeed: (feed: Omit<Feed, "lastSeen" | "added">) => void;
  unfollowFeed: (url: string) => void;
  markFeedSeen: (url: string) => void;
  importData: (data: Partial<State>) => void;
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const DEFAULT_SETTINGS: Settings = {
  barPosition: "bottom",
  searchEngine: "bing",
  darkPages: false,
  adblock: true,
  archiveHours: 24,
  translateTo: "en",
  readerTheme: "paper",
  readerSize: 19,
  readerFont: "serif",
  haptics: true,
  voiceRate: 1,
  maxLiveTabs: 4,
  autoReader: false,
  dataSaver: false,
};

const HOME_SPACE: Space = { id: "home", name: "Home", emoji: "🏠" };

function blankTab(spaceId: string, incognito: boolean, url: string | null = null): Tab {
  return {
    id: uid(),
    spaceId,
    incognito,
    url,
    title: url ? hostOf(url) : "New tab",
    icon: "",
    image: "",
    themeColor: "",
    history: url ? [url] : [],
    index: url ? 0 : -1,
    lastActive: Date.now(),
    archivedAt: null,
    readable: false,
    blocked: 0,
    trackers: "",
    frame: url,
    nonce: 0,
    fresh: false,
    postBody: null,
    loading: !!url,
  };
}

const initial: State = {
  tabs: [],
  spaces: [HOME_SPACE],
  activeSpace: HOME_SPACE.id,
  activeBySpace: {},
  incognitoMode: false,
  split: null,
  history: [],
  bookmarks: [],
  sites: {},
  settings: DEFAULT_SETTINGS,
  stats: { total: 0, byHost: {}, byDay: {} },
  highlights: {},
  feeds: [],
};

/** localStorage that never throws (private windows, blocked storage, previews). */
const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* storage full or blocked */
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
}));

export const useBrowser = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...initial,

      activeTab: () => {
        const s = get();
        const key = s.incognitoMode ? "incognito" : s.activeSpace;
        const id = s.activeBySpace[key];
        const pool = s.tabs.filter((tab) => !tab.archivedAt && (s.incognitoMode ? tab.incognito : !tab.incognito && tab.spaceId === s.activeSpace));
        return pool.find((tab) => tab.id === id) ?? pool[pool.length - 1];
      },

      newTab: (url = null, opts = {}) => {
        const s = get();
        const incognito = opts.incognito ?? s.incognitoMode;
        const tab = blankTab(incognito ? "incognito" : s.activeSpace, incognito, url);
        set((state) => ({
          tabs: [...state.tabs, tab],
          incognitoMode: opts.background ? state.incognitoMode : incognito,
          activeBySpace: opts.background ? state.activeBySpace : { ...state.activeBySpace, [incognito ? "incognito" : state.activeSpace]: tab.id },
        }));
        return tab.id;
      },

      closeTab: (id) => {
        const s = get();
        const tab = s.tabs.find((item) => item.id === id);
        if (!tab) return undefined;
        const key = tab.incognito ? "incognito" : tab.spaceId;
        const siblings = s.tabs.filter((item) => !item.archivedAt && item.incognito === tab.incognito && (tab.incognito || item.spaceId === tab.spaceId));
        const index = siblings.findIndex((item) => item.id === id);
        const neighbor = siblings[index + 1] ?? siblings[index - 1];
        set((state) => ({
          tabs: state.tabs.filter((item) => item.id !== id),
          activeBySpace: state.activeBySpace[key] === id ? { ...state.activeBySpace, [key]: neighbor?.id ?? "" } : state.activeBySpace,
          split: state.split && (state.split.a === id || state.split.b === id) ? null : state.split,
          incognitoMode: tab.incognito && !neighbor ? false : state.incognitoMode,
        }));
        return tab;
      },

      restoreTab: (tab) =>
        set((state) => ({
          tabs: [...state.tabs, { ...tab, frame: tab.url, nonce: tab.nonce + 1, loading: !!tab.url }],
          activeBySpace: { ...state.activeBySpace, [tab.incognito ? "incognito" : tab.spaceId]: tab.id },
        })),

      activate: (id) =>
        set((state) => {
          const tab = state.tabs.find((item) => item.id === id);
          if (!tab) return {};
          return {
            incognitoMode: tab.incognito,
            activeSpace: tab.incognito ? state.activeSpace : tab.spaceId,
            activeBySpace: { ...state.activeBySpace, [tab.incognito ? "incognito" : tab.spaceId]: id },
            tabs: state.tabs.map((item) => (item.id === id ? { ...item, lastActive: Date.now(), archivedAt: null } : item)),
          };
        }),

      navigate: (id, url, opts = {}) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== id) return tab;
            const base = opts.replace && tab.index >= 0 ? tab.history.slice(0, tab.index) : tab.history.slice(0, tab.index + 1);
            const history = [...base, url].slice(-60);
            return {
              ...tab,
              url,
              frame: url,
              title: hostOf(url),
              icon: "",
              image: "",
              themeColor: "",
              history,
              index: history.length - 1,
              nonce: tab.nonce + 1,
              fresh: false,
              postBody: opts.postBody ?? null,
              loading: true,
              readable: false,
              blocked: 0,
              trackers: "",
              lastActive: Date.now(),
            };
          }),
        })),

      step: (id, dir) => {
        const tab = get().tabs.find((item) => item.id === id);
        if (!tab) return false;
        const index = tab.index + dir;
        if (index < 0 || index >= tab.history.length) return false;
        const url = tab.history[index];
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === id
              ? { ...item, index, url, frame: url, title: hostOf(url), nonce: item.nonce + 1, fresh: false, loading: true, postBody: null, readable: false, blocked: 0 }
              : item,
          ),
        }));
        return true;
      },

      reload: (id) =>
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === id && item.url ? { ...item, frame: item.url, nonce: item.nonce + 1, fresh: true, loading: true, postBody: null } : item,
          ),
        })),

      patchTab: (id, patch) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) } : tab)),
        })),

      setIncognito: (on) => set({ incognitoMode: on }),

      addSpace: (name, emoji) => {
        const space = { id: uid(), name: name.trim() || "Space", emoji: emoji || "✨" };
        set((state) => ({ spaces: [...state.spaces, space], activeSpace: space.id, incognitoMode: false }));
        return space.id;
      },

      renameSpace: (id, name, emoji) =>
        set((state) => ({ spaces: state.spaces.map((space) => (space.id === id ? { ...space, name: name.trim() || space.name, emoji: emoji || space.emoji } : space)) })),

      removeSpace: (id) =>
        set((state) => {
          if (state.spaces.length <= 1) return {};
          const spaces = state.spaces.filter((space) => space.id !== id);
          return {
            spaces,
            tabs: state.tabs.filter((tab) => tab.spaceId !== id),
            activeSpace: state.activeSpace === id ? spaces[0].id : state.activeSpace,
          };
        }),

      switchSpace: (id) => set({ activeSpace: id, incognitoMode: false }),

      moveTab: (id, spaceId) =>
        set((state) => ({ tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, spaceId, incognito: false } : tab)) })),

      archiveStale: () => {
        const s = get();
        const cutoff = Date.now() - s.settings.archiveHours * 3_600_000;
        const activeIds = new Set(Object.values(s.activeBySpace));
        let count = 0;
        const tabs = s.tabs.map((tab) => {
          if (tab.archivedAt || tab.incognito || activeIds.has(tab.id) || tab.lastActive > cutoff || !tab.url) return tab;
          count += 1;
          return { ...tab, archivedAt: Date.now() };
        });
        // Empty new-tab pages that weren't used just disappear.
        const cleaned = tabs.filter((tab) => tab.url || activeIds.has(tab.id) || tab.lastActive > cutoff);
        if (count || cleaned.length !== tabs.length) set({ tabs: cleaned });
        return count;
      },

      unarchive: (id) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, archivedAt: null, lastActive: Date.now() } : tab)),
        })),

      setSplit: (split) => set({ split }),

      remember: (url, title) => {
        if (get().incognitoMode) return;
        set((state) => {
          const last = state.history[0];
          if (last && last.url === url) {
            return { history: [{ ...last, title: title || last.title, at: Date.now() }, ...state.history.slice(1)] };
          }
          return { history: [{ url, title, at: Date.now() }, ...state.history].slice(0, 1500) };
        });
      },

      forget: (url, at) =>
        set((state) => ({ history: state.history.filter((item) => !(item.url === url && (at === undefined || item.at === at))) })),

      clearHistory: () => set({ history: [] }),

      toggleBookmark: (url, title) =>
        set((state) => ({
          bookmarks: state.bookmarks.some((item) => item.url === url)
            ? state.bookmarks.filter((item) => item.url !== url)
            : [{ url, title: title || hostOf(url), at: Date.now() }, ...state.bookmarks].slice(0, 500),
        })),

      site: (url) => {
        const host = hostOf(url);
        return (host && get().sites[host]) || {};
      },

      setSite: (url, patch) =>
        set((state) => {
          const host = hostOf(url);
          if (!host) return {};
          const sites = { ...state.sites };
          if (patch === null) delete sites[host];
          else sites[host] = { ...sites[host], ...patch };
          return { sites };
        }),

      setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

      countBlocked: (trackers, count) => {
        if (!count) return;
        set((state) => {
          const byHost = { ...state.stats.byHost };
          for (const pair of trackers.split(",")) {
            const [host, n] = pair.split(":");
            if (host) byHost[host] = (byHost[host] || 0) + (Number(n) || 1);
          }
          const day = today();
          const byDay = { ...state.stats.byDay, [day]: (state.stats.byDay[day] || 0) + count };
          for (const key of Object.keys(byDay).sort().slice(0, -60)) delete byDay[key];
          const trimmed = Object.fromEntries(Object.entries(byHost).sort((a, b) => b[1] - a[1]).slice(0, 200));
          return { stats: { total: state.stats.total + count, byHost: trimmed, byDay } };
        });
      },

      clearAll: () => set({ ...initial, settings: get().settings }),


      addHighlight: (url, title, text) => {
        const id = uid();
        set((state) => ({
          highlights: { ...state.highlights, [url]: [...(state.highlights[url] || []), { id, text: text.slice(0, 2000), note: "", at: Date.now(), title }] },
        }));
        return id;
      },

      noteHighlight: (url, id, note) =>
        set((state) => ({
          highlights: { ...state.highlights, [url]: (state.highlights[url] || []).map((h) => (h.id === id ? { ...h, note } : h)) },
        })),

      removeHighlight: (url, id) =>
        set((state) => {
          const list = (state.highlights[url] || []).filter((h) => h.id !== id);
          const highlights = { ...state.highlights };
          if (list.length) highlights[url] = list;
          else delete highlights[url];
          return { highlights };
        }),

      followFeed: (feed) =>
        set((state) =>
          state.feeds.some((item) => item.url === feed.url)
            ? {}
            : { feeds: [...state.feeds, { ...feed, lastSeen: Date.now() - 3 * 86_400_000, added: Date.now() }] },
        ),

      unfollowFeed: (url) => set((state) => ({ feeds: state.feeds.filter((item) => item.url !== url) })),

      markFeedSeen: (url) => set((state) => ({ feeds: state.feeds.map((item) => (item.url === url ? { ...item, lastSeen: Date.now() } : item)) })),


      importData: (data) =>
        set((state) => ({
          spaces: data.spaces?.length ? data.spaces : state.spaces,
          tabs: Array.isArray(data.tabs) ? data.tabs.map((tab) => ({ ...tab, frame: tab.url, nonce: 0, fresh: false, postBody: null, loading: false })) : state.tabs,
          history: Array.isArray(data.history) ? data.history : state.history,
          bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : state.bookmarks,
          sites: data.sites && typeof data.sites === "object" ? data.sites : state.sites,
          settings: { ...state.settings, ...(data.settings || {}) },
          highlights: data.highlights && typeof data.highlights === "object" ? data.highlights : state.highlights,
          feeds: Array.isArray(data.feeds) ? data.feeds : state.feeds,
          activeSpace: data.spaces?.length ? data.spaces[0].id : state.activeSpace,
          activeBySpace: {},
        })),
    }),
    {
      name: "massweb-state",
      version: 1,
      storage: safeStorage,
      partialize: (state) => ({
        tabs: state.tabs
          .filter((tab) => !tab.incognito)
          .map((tab) => ({ ...tab, frame: null, nonce: 0, fresh: false, postBody: null, loading: false })),
        spaces: state.spaces,
        activeSpace: state.activeSpace,
        activeBySpace: Object.fromEntries(Object.entries(state.activeBySpace).filter(([key]) => key !== "incognito")),
        history: state.history,
        bookmarks: state.bookmarks,
        sites: state.sites,
        settings: state.settings,
        stats: state.stats,
        highlights: state.highlights,
        feeds: state.feeds,
      }),
      merge: (persisted, current) => {
        const saved = (persisted || {}) as Partial<State>;
        return {
          ...current,
          ...saved,
          settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
          spaces: saved.spaces && saved.spaces.length ? saved.spaces : current.spaces,
          tabs: (saved.tabs || []).map((tab) => ({ ...tab, frame: tab.url, nonce: 0, fresh: false, postBody: null, loading: false })),
          incognitoMode: false,
          split: null,
        };
      },
    },
  ),
);
