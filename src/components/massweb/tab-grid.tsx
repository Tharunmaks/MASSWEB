import { Archive, Columns2, FolderInput, Pencil, Plus, Search, Star, Trash2, VenetianMask, X } from "lucide-react";
import { useRef, useState } from "react";
import { hostOf } from "@/lib/browser/destination";
import { haptic } from "@/lib/browser/device";
import { type Tab, useBrowser } from "@/lib/browser/state";
import { toast } from "@/lib/browser/toast";
import { Row, Sheet, SiteIcon } from "./ui";

const EMOJI = ["🏠", "💼", "📚", "🎮", "⚽", "🧠", "🎨", "🛒", "✈️", "🎵", "🧪", "✨"];

function tint(color: string): string {
  return color && /^#|^rgb|^hsl/i.test(color) ? color : "var(--mw-stone)";
}

export function TabGrid({
  open,
  morphId,
  onClose,
  onPick,
  onNewTab,
  onSplitWith,
}: {
  open: boolean;
  morphId: string | null;
  onClose: () => void;
  onPick: (id: string, el: HTMLElement | null) => void;
  onNewTab: () => void;
  onSplitWith: (id: string) => void;
}) {
  const s = useBrowser();
  const [menuTab, setMenuTab] = useState<Tab | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; emoji: string } | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [query, setQuery] = useState("");
  if (!open) return null;

  const active = s.activeTab();
  const spacePool = s.tabs.filter((tab) => !tab.archivedAt && (s.incognitoMode ? tab.incognito : !tab.incognito && tab.spaceId === s.activeSpace));
  const needle = query.trim().toLowerCase();
  const pool = needle
    ? s.tabs.filter((tab) => !tab.archivedAt && tab.incognito === s.incognitoMode && `${tab.title} ${tab.url ?? ""}`.toLowerCase().includes(needle))
    : spacePool;


  const archived = s.tabs.filter((tab) => tab.archivedAt && !tab.incognito).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const incognitoCount = s.tabs.filter((tab) => tab.incognito).length;

  const close = (tab: Tab) => {
    const removed = s.closeTab(tab.id);
    haptic();
    if (removed) toast(`Closed ${removed.title || "tab"}`, { label: "Undo", run: () => useBrowser.getState().restoreTab(removed) });
  };

  return (
    <div className="mw-scrim fixed inset-0 z-30 flex flex-col bg-paper" role="dialog" aria-label="Tabs">
      <div className="shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 pt-3">
          <div className="mw-noscroll flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
            {s.spaces.map((space) => {
              const selected = !s.incognitoMode && space.id === s.activeSpace;
              const count = s.tabs.filter((tab) => !tab.incognito && !tab.archivedAt && tab.spaceId === space.id).length;
              return (
                <button
                  key={space.id}
                  type="button"
                  onClick={() => {
                    if (selected) setEditing({ id: space.id, name: space.name, emoji: space.emoji });
                    else {
                      haptic();
                      s.switchSpace(space.id);
                    }
                  }}
                  className={`mw-press flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm ${
                    selected ? "bg-ink text-paper" : "bg-stone text-ink"
                  }`}
                >
                  <span aria-hidden>{space.emoji}</span>
                  <span className="max-w-28 truncate">{space.name}</span>
                  <span className={`text-xs tabular-nums ${selected ? "opacity-70" : "text-mute"}`}>{count}</span>
                  {selected ? <Pencil className="h-3 w-3 opacity-60" aria-hidden /> : null}
                </button>
              );
            })}
            <button
              type="button"
              aria-label="New space"
              onClick={() => setEditing({ id: null, name: "", emoji: EMOJI[(s.spaces.length + 1) % EMOJI.length] })}
              className="mw-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            aria-label={s.incognitoMode ? "Leave incognito tabs" : "Incognito tabs"}
            aria-pressed={s.incognitoMode}
            onClick={() => {
              haptic();
              if (s.incognitoMode) s.setIncognito(false);
              else if (incognitoCount) s.setIncognito(true);
              else {
                s.newTab(null, { incognito: true });
                onClose();
              }
            }}
            className={`mw-press flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm ${s.incognitoMode ? "bg-cobalt text-white" : "bg-stone"}`}
          >
            <VenetianMask className="h-4 w-4" />
            {incognitoCount ? <span className="tabular-nums">{incognitoCount}</span> : null}
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-stone px-3.5">
          <Search className="h-4 w-4 shrink-0 text-mute" />
          <span className="sr-only">Search tabs</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all tabs" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-mute" />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="text-mute">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>

      </div>

      <div className="mw-noscroll min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-28">
        {pool.length === 0 ? (
          <div className="grid h-48 place-items-center text-center text-sm text-mute">
            {s.incognitoMode ? "No incognito tabs. Nothing you browse here is saved." : "No tabs in this space yet."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {pool.map((tab) => (
              <TabCard
                key={tab.id}
                tab={tab}
                selected={tab.id === active?.id}
                morph={morphId ? morphId === tab.id : tab.id === active?.id}
                onPick={(el) => onPick(tab.id, el)}
                onClose={() => close(tab)}
                onMenu={() => {
                  haptic(14);
                  setMenuTab(tab);
                }}
              />
            ))}
          </div>
        )}

        {!s.incognitoMode && archived.length ? (
          <div className="mt-8">
            <button
              type="button"
              onClick={() => setShowArchive((v) => !v)}
              className="mw-press flex h-11 w-full items-center gap-2 rounded-xl px-1 text-sm text-mute"
            >
              <Archive className="h-4 w-4" />
              Archived · {archived.length}
              <span className="ml-auto text-xs">{showArchive ? "Hide" : "Show"}</span>
            </button>
            {showArchive ? (
              <div className="mw-rise mt-1 divide-y divide-rule/60">
                {archived.slice(0, 60).map((tab) => (
                  <div key={tab.id} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <Row
                        icon={<SiteIcon url={tab.url} icon={tab.icon} size={18} />}
                        title={tab.title || hostOf(tab.url)}
                        detail={hostOf(tab.url)}
                        onClick={() => {
                          s.unarchive(tab.id);
                          onPick(tab.id, null);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${tab.title}`}
                      onClick={() => s.closeTab(tab.id)}
                      className="mw-press flex h-11 w-11 shrink-0 items-center justify-center text-mute"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-paper via-paper/95 to-transparent px-4 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => {
            if (!pool.length) return;
            for (const tab of pool) s.closeTab(tab.id);
            toast(`Closed ${pool.length} tabs`);
          }}
          className="mw-press pointer-events-auto h-12 rounded-full px-4 text-sm text-mute"
        >
          Close all
        </button>
        <button
          type="button"
          onClick={() => {
            haptic();
            onNewTab();
          }}
          className={`mw-press pointer-events-auto flex h-14 items-center gap-2 rounded-full px-6 text-[15px] font-medium shadow-lift ${
            s.incognitoMode ? "bg-cobalt text-white" : "bg-ink text-paper"
          }`}
        >
          <Plus className="h-5 w-5" />
          {s.incognitoMode ? "Incognito tab" : "New tab"}
        </button>
        <button type="button" onClick={onClose} className="mw-press pointer-events-auto h-12 rounded-full px-4 text-sm font-medium text-cobalt">
          Done
        </button>
      </div>

      <Sheet open={!!menuTab} onClose={() => setMenuTab(null)} title={menuTab?.title || "Tab"} label="Tab options">
        {menuTab ? (
          <div className="pb-2">
            {active && menuTab.id !== active.id ? (
              <Row
                icon={<Columns2 className="h-4 w-4" />}
                title="Split view with current tab"
                onClick={() => {
                  onSplitWith(menuTab.id);
                  setMenuTab(null);
                }}
              />
            ) : null}
            {menuTab.url ? (
              <Row
                icon={<Star className="h-4 w-4" />}
                title={s.bookmarks.some((b) => b.url === menuTab.url) ? "Remove bookmark" : "Bookmark"}
                onClick={() => {
                  s.toggleBookmark(menuTab.url!, menuTab.title);
                  setMenuTab(null);
                }}
              />
            ) : null}
            {!menuTab.incognito
              ? s.spaces
                  .filter((space) => space.id !== menuTab.spaceId)
                  .map((space) => (
                    <Row
                      key={space.id}
                      icon={<FolderInput className="h-4 w-4" />}
                      title={`Move to ${space.emoji} ${space.name}`}
                      onClick={() => {
                        s.moveTab(menuTab.id, space.id);
                        toast(`Moved to ${space.name}`);
                        setMenuTab(null);
                      }}
                    />
                  ))
              : null}
            <Row
              icon={<Trash2 className="h-4 w-4" />}
              title="Close tab"
              danger
              onClick={() => {
                close(menuTab);
                setMenuTab(null);
              }}
            />
          </div>
        ) : null}
      </Sheet>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit space" : "New space"} label="Space">
        {editing ? (
          <form
            className="space-y-4 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (editing.id) s.renameSpace(editing.id, editing.name, editing.emoji);
              else s.addSpace(editing.name || "New space", editing.emoji);
              setEditing(null);
            }}
          >
            <div className="grid grid-cols-6 gap-2">
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Icon ${emoji}`}
                  aria-pressed={editing.emoji === emoji}
                  onClick={() => setEditing({ ...editing, emoji })}
                  className={`mw-press h-12 rounded-2xl text-xl ${editing.emoji === emoji ? "bg-ink" : "bg-stone"}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-sm text-mute">Name</span>
              <input
                autoFocus
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="Work, Study, Football…"
                className="mt-1 h-12 w-full rounded-xl bg-stone px-4 text-base outline-none focus:ring-2 focus:ring-cobalt"
              />
            </label>
            <div className="flex gap-2">
              {editing.id && s.spaces.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    s.removeSpace(editing.id!);
                    setEditing(null);
                    toast("Space deleted");
                  }}
                  className="mw-press h-12 rounded-full px-5 text-sm text-ember"
                >
                  Delete space
                </button>
              ) : null}
              <button type="submit" className="mw-press ml-auto h-12 rounded-full bg-ink px-6 text-sm font-medium text-paper">
                {editing.id ? "Save" : "Create space"}
              </button>
            </div>
          </form>
        ) : null}
      </Sheet>
    </div>
  );
}

function TabCard({
  tab,
  selected,
  morph,
  onPick,
  onClose,
  onMenu,
}: {
  tab: Tab;
  selected: boolean;
  morph: boolean;
  onPick: (el: HTMLElement | null) => void;
  onClose: () => void;
  onMenu: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<{ x: number; y: number; t: number; mode: "none" | "h" | "v"; long: ReturnType<typeof setTimeout> | null; fired: boolean } | null>(null);
  const host = hostOf(tab.url);

  return (
    <div className="mw-rise">
    <div
      ref={ref}
      style={{
        transform: leaving ? `translateX(${leaving * 120}%)` : dx ? `translateX(${dx}px) rotate(${dx / 40}deg)` : undefined,
        opacity: leaving ? 0 : dx ? Math.max(0.3, 1 - Math.abs(dx) / 260) : 1,
        transition: dx && !leaving ? "none" : "transform 280ms var(--mw-spatial-fast), opacity 220ms var(--mw-effects)",
        viewTransitionName: morph ? "mw-morph" : undefined,
      }}
      className={`relative flex aspect-[3/4] touch-pan-y flex-col overflow-hidden rounded-[20px] bg-card select-none ${
        selected ? "ring-[2.5px] ring-cobalt" : "shadow-ring"
      }`}
      onPointerDown={(event) => {
        const long = setTimeout(() => {
          if (g.current && g.current.mode === "none") {
            g.current.fired = true;
            onMenu();
          }
        }, 500);
        g.current = { x: event.clientX, y: event.clientY, t: Date.now(), mode: "none", long, fired: false };
      }}
      onPointerMove={(event) => {
        const s = g.current;
        if (!s) return;
        const mx = event.clientX - s.x;
        const my = event.clientY - s.y;
        if (s.mode === "none" && Math.hypot(mx, my) > 10) {
          s.mode = Math.abs(mx) > Math.abs(my) * 1.2 ? "h" : "v";
          if (s.long) clearTimeout(s.long);
          if (s.mode === "h") event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (s.mode === "h") setDx(mx);
      }}
      onPointerUp={(event) => {
        const s = g.current;
        g.current = null;
        if (!s) return;
        if (s.long) clearTimeout(s.long);
        if (s.fired) return;
        const mx = event.clientX - s.x;
        if (s.mode === "h") {
          const width = ref.current?.offsetWidth ?? 160;
          const fast = Math.abs(mx) / Math.max(1, Date.now() - s.t) > 0.5;
          if (Math.abs(mx) > width * 0.4 || (fast && Math.abs(mx) > 40)) {
            setLeaving(mx < 0 ? -1 : 1);
            setTimeout(onClose, 200);
          } else setDx(0);
          return;
        }
        if (s.mode === "none" && !(event.target as HTMLElement).closest("[data-close]")) onPick(ref.current);
      }}
      onPointerCancel={() => {
        if (g.current?.long) clearTimeout(g.current.long);
        g.current = null;
        setDx(0);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 pr-1 pl-3">
        {tab.url ? <SiteIcon url={tab.url} icon={tab.icon} size={16} /> : <span className="h-4 w-4 rounded bg-stone" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{tab.title || "New tab"}</span>
        <button
          type="button"
          data-close
          aria-label={`Close ${tab.title || "tab"}`}
          onClick={(event) => {
            event.stopPropagation();
            setLeaving(1);
            setTimeout(onClose, 180);
          }}
          className="mw-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mute"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: tint(tab.themeColor) }}>
        {tab.image && !imageFailed ? (
          <img src={tab.image} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center">
            {tab.url ? <SiteIcon url={tab.url} icon={tab.icon} size={44} /> : null}
            <span className="line-clamp-2 text-xs text-mute">{tab.url ? host : "New tab"}</span>
          </div>
        )}
        {tab.blocked ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            {tab.blocked} blocked
          </span>
        ) : null}
      </div>
    </div>
    </div>
  );
}
