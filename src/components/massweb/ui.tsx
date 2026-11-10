import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hostOf } from "@/lib/browser/destination";
import { useToast } from "@/lib/browser/toast";

/** Keeps something mounted for its exit animation after `open` turns false. */
export function usePresence(open: boolean, exitMs = 200): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs, mounted]);
  return { mounted, closing };
}

/** A bottom sheet you can drag down to dismiss. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  height = "auto",
  actions,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  height?: "auto" | "tall" | "full";
  actions?: ReactNode;
  label?: string;
}) {
  const { mounted, closing } = usePresence(open);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ y: number; t: number } | null>(null);
  if (!mounted) return null;
  const heightClass = height === "full" ? "h-[94dvh]" : height === "tall" ? "max-h-[88dvh] min-h-[60dvh]" : "max-h-[88dvh]";
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        data-closing={closing ? "1" : "0"}
        className="mw-scrim absolute inset-0 cursor-default bg-[var(--mw-scrim)]"
        onClick={onClose}
      />
      <div
        data-closing={closing ? "1" : "0"}
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, ["--mw-drag" as string]: `${drag}px` }}
        className={`mw-sheet relative mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-card shadow-lift ${heightClass}`}
      >
        <div
          className="shrink-0 touch-none px-5 pt-2.5 pb-2"
          onPointerDown={(event) => {
            // Let buttons in the header (close, actions) take their own taps.
            if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
            start.current = { y: event.clientY, t: Date.now() };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            setDrag(Math.max(0, event.clientY - start.current.y));
          }}
          onPointerUp={(event) => {
            if (!start.current) return;
            const dy = event.clientY - start.current.y;
            const velocity = dy / Math.max(1, Date.now() - start.current.t);
            start.current = null;
            if (dy > 90 || (dy > 24 && velocity > 0.6)) onClose();
            setDrag(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-rule" />
          {title || actions ? (
            <div className="mt-3 flex min-h-9 items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</div>
              {actions}
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="mw-press -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-mute hover:bg-stone"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

/** Site icon: the page's own icon, then Google's favicon service, then a letter tile. */
export function SiteIcon({ url, icon, size = 16, className = "" }: { url: string | null; icon?: string; size?: number; className?: string }) {
  const host = hostOf(url);
  const sources = [icon, host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size > 24 ? 128 : 64}` : ""].filter(
    (src): src is string => !!src,
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setAttempt(0), [icon, host]);
  const src = sources[attempt];
  if (!host || !src) {
    return (
      <span
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.55) }}
        className={`flex shrink-0 items-center justify-center rounded-[28%] bg-stone font-semibold text-ink uppercase ${className}`}
      >
        {host ? host.slice(0, 1) : ""}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-[22%] object-contain ${className}`}
      onError={() => setAttempt((n) => n + 1)}
      referrerPolicy="no-referrer"
    />
  );
}

export function ToastView({ offset }: { offset: number }) {
  const toast = useToast((s) => s.toast);
  const hide = useToast((s) => s.hide);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4" style={{ bottom: offset }}>
      <div
        key={toast.id}
        role="status"
        className="mw-rise pointer-events-auto flex min-h-12 max-w-md items-center gap-3 rounded-2xl bg-ink py-2 pr-2 pl-4 text-sm text-paper shadow-lift"
      >
        <span className="min-w-0 flex-1">{toast.text}</span>
        {toast.action ? (
          <button
            type="button"
            onClick={() => {
              toast.action?.run();
              hide();
            }}
            className="mw-press h-9 shrink-0 rounded-xl px-3 font-semibold text-[color-mix(in_srgb,var(--mw-cobalt)_55%,white)]"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-cobalt" : "bg-rule"}`}
    >
      <span
        style={{ transitionTimingFunction: "var(--mw-spatial-fast)" }}
        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-300 ${checked ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

export function Row({
  icon,
  title,
  detail,
  onClick,
  trailing,
  danger,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
  danger?: boolean;
}) {
  const body = (
    <>
      {icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone text-ink">{icon}</span> : null}
      <span className="min-w-0 flex-1 text-left">
        <span className={`block truncate text-[15px] ${danger ? "text-ember" : ""}`}>{title}</span>
        {detail ? <span className="block truncate text-xs text-mute">{detail}</span> : null}
      </span>
      {trailing}
    </>
  );
  if (!onClick) return <div className="flex min-h-14 items-center gap-3 py-1.5">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="mw-press flex min-h-14 w-full items-center gap-3 rounded-xl py-1.5 active:bg-stone/60">
      {body}
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-stone p-1">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-9 min-w-0 flex-1 truncate rounded-lg px-2 text-sm transition-colors duration-150 ${
            value === option.value ? "bg-card font-medium text-ink shadow-sm" : "text-mute"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
