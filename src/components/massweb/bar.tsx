import { ArrowLeft, BookOpen, EllipsisVertical, Lock, LockOpen, Search, ShieldCheck, VenetianMask } from "lucide-react";
import { useRef, useState } from "react";
import { displayText } from "@/lib/browser/destination";
import { haptic } from "@/lib/browser/device";
import type { Tab } from "@/lib/browser/state";

type Props = {
  tab: Tab | undefined;
  tabCount: number;
  position: "bottom" | "top";
  collapsed: boolean;
  incognito: boolean;
  canBack: boolean;
  onBack: () => void;
  onOpenOmnibox: () => void;
  onSwipeTab: (dir: -1 | 1) => boolean;
  onOpenTabs: () => void;
  onMenu: () => void;
  onLongPress: () => void;
  onExpand: () => void;
  onReader: () => void;
  onShield: () => void;
};

/** The address bar. Tap to type, swipe sideways to change tab, swipe toward the page for the tab grid. */
export function Bar(props: Props) {
  const { tab, tabCount, position, collapsed, incognito } = props;
  const [dx, setDx] = useState(0);
  const [enter, setEnter] = useState<"left" | "right" | null>(null);
  const gesture = useRef<{ x: number; y: number; t: number; mode: "none" | "h" | "v"; long: ReturnType<typeof setTimeout> | null; fired: boolean } | null>(null);
  const width = useRef(320);

  const label = tab?.url ? displayText(tab.url) : "";
  const secure = !!tab?.url && tab.url.startsWith("https://");

  if (collapsed) {
    return (
      <div className={`flex justify-center bg-paper ${position === "bottom" ? "pb-[env(safe-area-inset-bottom)]" : "pt-[env(safe-area-inset-top)]"}`}>
        <button
          type="button"
          onClick={props.onExpand}
          aria-label="Show toolbar"
          className="mw-pop flex h-8 max-w-[70%] items-center gap-1.5 px-4 text-[13px] text-ink"
        >
          {secure ? <Lock className="h-3 w-3 text-mute" aria-hidden /> : null}
          <span className="truncate">{label || "New tab"}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative z-20 bg-paper ${
        position === "bottom" ? "pb-[env(safe-area-inset-bottom)] shadow-[var(--mw-bar-shadow)]" : "border-b border-rule/70 pt-[env(safe-area-inset-top)]"
      }`}
    >
      <div className="mx-auto flex h-[60px] max-w-3xl items-center gap-1 px-1.5">
        <button
          type="button"
          aria-label="Back"
          disabled={!props.canBack}
          onClick={props.onBack}
          className="mw-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink disabled:text-rule"
        >
          <ArrowLeft className="h-[22px] w-[22px]" />
        </button>

        <div
          role="button"
          tabIndex={0}
          aria-label={label ? `Address: ${label}. Tap to search or type a web address` : "Search or type a web address"}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") props.onOpenOmnibox();
          }}
          className="relative flex h-11 min-w-0 flex-1 touch-none items-center overflow-hidden rounded-full bg-stone select-none"
          onPointerDown={(event) => {
            width.current = event.currentTarget.getBoundingClientRect().width;
            event.currentTarget.setPointerCapture(event.pointerId);
            const long = setTimeout(() => {
              if (!gesture.current || gesture.current.mode !== "none") return;
              gesture.current.fired = true;
              haptic(14);
              props.onLongPress();
            }, 480);
            gesture.current = { x: event.clientX, y: event.clientY, t: Date.now(), mode: "none", long, fired: false };
          }}
          onPointerMove={(event) => {
            const g = gesture.current;
            if (!g) return;
            const mx = event.clientX - g.x;
            const my = event.clientY - g.y;
            if (g.mode === "none" && Math.hypot(mx, my) > 10) {
              g.mode = Math.abs(mx) > Math.abs(my) ? "h" : "v";
              if (g.long) clearTimeout(g.long);
            }
            if (g.mode === "h") setDx(mx);
          }}
          onPointerUp={(event) => {
            const g = gesture.current;
            gesture.current = null;
            if (!g) return;
            if (g.long) clearTimeout(g.long);
            const mx = event.clientX - g.x;
            const my = event.clientY - g.y;
            const dt = Math.max(1, Date.now() - g.t);
            if (g.fired) return;
            if (g.mode === "h") {
              const fast = Math.abs(mx) / dt > 0.45;
              if (Math.abs(mx) > width.current * 0.28 || (fast && Math.abs(mx) > 30)) {
                const dir = mx < 0 ? 1 : -1;
                if (props.onSwipeTab(dir)) {
                  haptic();
                  setEnter(dir === 1 ? "right" : "left");
                }
              }
              setDx(0);
              return;
            }
            if (g.mode === "v") {
              const towardPage = position === "bottom" ? my < -28 : my > 28;
              if (towardPage) {
                haptic();
                props.onOpenTabs();
              }
              return;
            }
            props.onOpenOmnibox();
          }}
          onPointerCancel={() => {
            if (gesture.current?.long) clearTimeout(gesture.current.long);
            gesture.current = null;
            setDx(0);
          }}
        >
          <div
            key={`${tab?.id ?? "none"}-${enter ?? ""}`}
            onAnimationEnd={() => setEnter(null)}
            className={`flex h-full min-w-0 flex-1 items-center gap-2 pr-1 pl-3.5 ${
              enter === "right" ? "mw-from-right" : enter === "left" ? "mw-from-left" : ""
            }`}
            style={{
              transform: dx ? `translateX(${dx}px)` : undefined,
              opacity: dx ? Math.max(0.35, 1 - Math.abs(dx) / (width.current * 0.9)) : undefined,
              transition: dx ? "none" : "transform 260ms var(--mw-spatial-fast), opacity 200ms var(--mw-effects)",
            }}
          >
            {incognito ? (
              <VenetianMask className="h-4 w-4 shrink-0 text-cobalt" aria-hidden />
            ) : tab?.url ? (
              secure ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-mute" aria-hidden />
              ) : (
                <LockOpen className="h-3.5 w-3.5 shrink-0 text-ember" aria-hidden />
              )
            ) : (
              <Search className="h-4 w-4 shrink-0 text-mute" aria-hidden />
            )}
            <span className={`min-w-0 flex-1 truncate text-[15px] ${label ? "text-ink" : "text-mute"}`}>{label || "Search or type address"}</span>
          </div>
          {tab?.url && tab.readable ? (
            <button
              type="button"
              aria-label="Reader view"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                props.onReader();
              }}
              className="mw-press flex h-11 w-10 shrink-0 items-center justify-center text-ink"
            >
              <BookOpen className="h-[18px] w-[18px]" />
            </button>
          ) : null}
          {tab?.url ? (
            <button
              type="button"
              aria-label={tab.blocked ? `${tab.blocked} ads and trackers blocked` : "Privacy shield"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                props.onShield();
              }}
              className="mw-press mr-1 flex h-9 min-w-9 shrink-0 items-center justify-center gap-0.5 rounded-full px-1.5 text-good"
            >
              <ShieldCheck className="h-[18px] w-[18px]" />
              {tab.blocked ? <span className="text-[11px] font-semibold tabular-nums">{tab.blocked > 99 ? "99+" : tab.blocked}</span> : null}
            </button>
          ) : null}
          {tab?.loading ? (
            <span className="pointer-events-none absolute inset-x-3 bottom-0 h-[2.5px] overflow-hidden rounded-full">
              <span key={`${tab.id}-${tab.nonce}`} className="mw-progress block h-full w-full rounded-full bg-cobalt" />
            </span>
          ) : null}
        </div>

        <button
          type="button"
          aria-label={`${tabCount} open tabs`}
          onClick={() => {
            haptic();
            props.onOpenTabs();
          }}
          className="mw-press flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span
            className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-[7px] border-2 px-0.5 text-[11px] font-semibold tabular-nums ${
              incognito ? "border-cobalt text-cobalt" : "border-ink"
            }`}
          >
            {tabCount > 99 ? ":D" : tabCount}
          </span>
        </button>
        <button type="button" aria-label="Menu" onClick={props.onMenu} className="mw-press flex h-11 w-10 shrink-0 items-center justify-center">
          <EllipsisVertical className="h-[22px] w-[22px]" />
        </button>
      </div>
    </div>
  );
}
