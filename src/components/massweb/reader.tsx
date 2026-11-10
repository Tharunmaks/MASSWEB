import { Bookmark, BookmarkCheck, Languages, Pause, Play, SkipForward, Type, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { canSpeak, haptic } from "@/lib/browser/device";
import { type Article, fetchArticle, getSaved, removeSaved, saveArticle } from "@/lib/browser/offline";
import { useBrowser } from "@/lib/browser/state";
import { toast } from "@/lib/browser/toast";
import { LANGUAGES, languageName, translateAll } from "@/lib/browser/translate";
import { Segmented } from "./ui";

const BLOCKS = "p, h1, h2, h3, h4, li, blockquote, figcaption, pre";

export function ReaderView({
  url,
  saved,
  autoListen,
  onClose,
  onOpenLink,
}: {
  url: string;
  saved?: Article | null;
  autoListen?: boolean;
  onClose: () => void;
  onOpenLink: (url: string) => void;
}) {
  const settings = useBrowser((s) => s.settings);
  const setSettings = useBrowser((s) => s.setSettings);
  const [article, setArticle] = useState<Article | null>(saved ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [showType, setShowType] = useState(false);
  const [translated, setTranslated] = useState<"no" | "busy" | "yes">("no");
  const contentRef = useRef<HTMLDivElement>(null);
  const originals = useRef<{ node: Text; text: string }[]>([]);

  useEffect(() => {
    if (saved) {
      setArticle(saved);
      return;
    }
    let live = true;
    setArticle(null);
    setError(null);
    fetchArticle(url)
      .then((data) => live && setArticle(data))
      .catch(async (err: unknown) => {
        const offline = await getSaved(url);
        if (!live) return;
        if (offline) setArticle(offline);
        else setError(err instanceof Error ? err.message : "Reader view couldn't load this page.");
      });
    return () => {
      live = false;
    };
  }, [url, saved]);

  useEffect(() => {
    getSaved(url).then((item) => setIsSaved(!!item));
  }, [url]);

  const speech = useSpeech(contentRef, article?.lang || "", settings.voiceRate);

  useEffect(() => {
    if (autoListen && article && canSpeak()) {
      const timer = setTimeout(() => speech.play(0), 250);
      return () => clearTimeout(timer);
    }
  }, [autoListen, article]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => speech.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function translate() {
    const root = contentRef.current;
    if (!root || !article) return;
    if (translated === "yes") {
      for (const item of originals.current) item.node.nodeValue = item.text;
      setTranslated("no");
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.nodeValue && /[A-Za-zÀ-￿]{2,}/.test(node.nodeValue) && !node.parentElement?.closest("pre, code")) nodes.push(node);
    }
    const header = document.querySelectorAll<HTMLElement>("[data-reader-head] [data-tr]");
    header.forEach((el) => {
      const node = el.firstChild;
      if (node && node.nodeType === 3) nodes.unshift(node as Text);
    });
    originals.current = nodes.map((node) => ({ node, text: node.nodeValue || "" }));
    setTranslated("busy");
    try {
      const from = await translateAll(
        nodes.map((node) => (node.nodeValue || "").trim()),
        settings.translateTo,
        (start, texts) => {
          texts.forEach((text, i) => {
            const item = originals.current[start + i];
            if (!item || !text) return;
            const lead = item.text.match(/^\s*/)?.[0] ?? "";
            const trail = item.text.match(/\s*$/)?.[0] ?? "";
            item.node.nodeValue = lead + text + trail;
          });
        },
      );
      setTranslated("yes");
      toast(`Translated${from ? ` from ${languageName(from)}` : ""} to ${languageName(settings.translateTo)}`);
    } catch (err) {
      setTranslated("no");
      toast(err instanceof Error ? err.message : "Translation failed.");
    }
  }

  async function toggleSave() {
    if (!article) return;
    haptic();
    if (isSaved) {
      await removeSaved(article.url);
      setIsSaved(false);
      toast("Removed from saved pages");
    } else {
      await saveArticle(article);
      setIsSaved(true);
      toast("Saved for offline reading");
    }
  }

  const theme = settings.readerTheme;
  return (
    <div className="mw-reader mw-rise absolute inset-0 z-10 flex flex-col" data-theme={theme}>
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--r-rule)] px-1.5" style={{ background: "var(--r-bg)" }}>
        <button type="button" aria-label="Close reader" onClick={onClose} className="mw-press flex h-11 w-11 items-center justify-center rounded-full">
          <X className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--r-mute)" }}>
          {article ? `${article.siteName || new URL(article.url).hostname.replace(/^www\./, "")} · ${article.minutes} min read` : "Reader"}
        </span>
        <button type="button" aria-label="Text settings" aria-expanded={showType} onClick={() => setShowType((v) => !v)} className="mw-press flex h-11 w-11 items-center justify-center rounded-full">
          <Type className="h-5 w-5" />
        </button>
        {canSpeak() ? (
          <button
            type="button"
            aria-label={speech.playing ? "Pause reading aloud" : "Read aloud"}
            disabled={!article}
            onClick={() => (speech.playing ? speech.pause() : speech.play())}
            className="mw-press flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40"
          >
            {speech.playing ? <Pause className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={translated === "yes" ? "Show original" : `Translate to ${languageName(settings.translateTo)}`}
          disabled={!article || translated === "busy"}
          onClick={translate}
          className={`mw-press flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${translated === "yes" ? "text-[var(--r-link)]" : ""}`}
        >
          <Languages className={`h-5 w-5 ${translated === "busy" ? "animate-pulse" : ""}`} />
        </button>
        <button
          type="button"
          aria-label={isSaved ? "Remove from saved" : "Save for offline"}
          disabled={!article}
          onClick={toggleSave}
          className={`mw-press flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40 ${isSaved ? "text-[var(--r-link)]" : ""}`}
        >
          {isSaved ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
        </button>
      </div>

      {showType ? (
        <div className="mw-pop shrink-0 space-y-3 border-b border-[var(--r-rule)] px-4 py-3" style={{ background: "var(--r-bg)" }}>
          <Segmented
            label="Reader theme"
            value={theme}
            onChange={(readerTheme) => setSettings({ readerTheme })}
            options={[
              { value: "paper", label: "Paper" },
              { value: "white", label: "White" },
              { value: "night", label: "Night" },
            ]}
          />
          <div className="flex items-center gap-3">
            <Segmented
              label="Font"
              value={settings.readerFont}
              onChange={(readerFont) => setSettings({ readerFont })}
              options={[
                { value: "serif", label: <span className="font-serif">Serif</span> },
                { value: "sans", label: "Sans" },
              ]}
            />
            <div className="flex shrink-0 items-center rounded-xl bg-stone p-1">
              <button type="button" aria-label="Smaller text" onClick={() => setSettings({ readerSize: Math.max(14, settings.readerSize - 1) })} className="h-9 w-11 rounded-lg text-sm">
                A−
              </button>
              <span className="w-8 text-center text-xs tabular-nums text-mute">{settings.readerSize}</span>
              <button type="button" aria-label="Larger text" onClick={() => setSettings({ readerSize: Math.min(28, settings.readerSize + 1) })} className="h-9 w-11 rounded-lg text-base">
                A+
              </button>
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span className="shrink-0" style={{ color: "var(--r-mute)" }}>
              Translate to
            </span>
            <select
              value={settings.translateTo}
              onChange={(event) => setSettings({ translateTo: event.target.value })}
              className="h-10 min-w-0 flex-1 rounded-xl bg-stone px-3 text-ink"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest("a");
          if (!link) {
            const block = (event.target as HTMLElement).closest(BLOCKS);
            if (block && speech.playing) speech.jumpTo(block as HTMLElement);
            return;
          }
          event.preventDefault();
          const href = link.getAttribute("href");
          if (href) onOpenLink(href);
        }}
      >
        <article className="mx-auto max-w-[38rem] px-5 pt-8 pb-40">
          {error ? (
            <div className="mw-rise py-16 text-center">
              <p className="text-lg font-semibold">No article here</p>
              <p className="mt-1 text-sm" style={{ color: "var(--r-mute)" }}>
                {error}
              </p>
              <button type="button" onClick={onClose} className="mw-press mt-5 h-11 rounded-full bg-ink px-5 text-sm text-paper">
                Back to page
              </button>
            </div>
          ) : !article ? (
            <div className="animate-pulse space-y-4" aria-label="Loading article">
              <div className="h-8 w-4/5 rounded-lg bg-[var(--r-rule)]" />
              <div className="h-4 w-1/3 rounded bg-[var(--r-rule)]" />
              <div className="h-48 rounded-2xl bg-[var(--r-rule)]" />
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-4 rounded bg-[var(--r-rule)]" style={{ width: `${92 - (i % 3) * 9}%` }} />
              ))}
            </div>
          ) : (
            <>
              <header data-reader-head className="mb-8">
                <h1 data-tr className="font-serif text-[1.85rem] leading-[1.15] font-semibold tracking-tight">
                  {article.title}
                </h1>
                {article.byline ? (
                  <p className="mt-3 text-sm" style={{ color: "var(--r-mute)" }}>
                    {article.byline}
                  </p>
                ) : null}
              </header>
              <div
                ref={contentRef}
                className="mw-prose"
                data-font={settings.readerFont}
                style={{ fontSize: settings.readerSize }}
                lang={article.lang || undefined}
                dangerouslySetInnerHTML={{ __html: article.html }}
              />
            </>
          )}
        </article>
      </div>

      {speech.active ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <div className="mw-rise pointer-events-auto flex items-center gap-1 rounded-full bg-ink py-1.5 pr-1.5 pl-4 text-paper shadow-lift">
            <span className="mr-2 text-xs tabular-nums opacity-75">
              {speech.index + 1}/{speech.total}
            </span>
            <button type="button" aria-label={speech.playing ? "Pause" : "Play"} onClick={() => (speech.playing ? speech.pause() : speech.play())} className="mw-press flex h-10 w-10 items-center justify-center rounded-full">
              {speech.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button type="button" aria-label="Next paragraph" onClick={speech.next} className="mw-press flex h-10 w-10 items-center justify-center rounded-full">
              <SkipForward className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Reading speed"
              onClick={() => {
                const rates = [0.85, 1, 1.25, 1.5, 2];
                const next = rates[(rates.indexOf(settings.voiceRate) + 1) % rates.length] ?? 1;
                setSettings({ voiceRate: next });
              }}
              className="mw-press h-10 min-w-12 rounded-full px-2 text-sm font-medium tabular-nums"
            >
              {settings.voiceRate}×
            </button>
            <button type="button" aria-label="Stop reading" onClick={speech.stop} className="mw-press flex h-10 w-10 items-center justify-center rounded-full">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Read the article aloud paragraph by paragraph with the phone's built-in voices. */
function useSpeech(rootRef: React.RefObject<HTMLDivElement | null>, lang: string, rate: number) {
  const [state, setState] = useState({ active: false, playing: false, index: 0, total: 0 });
  const blocks = useRef<HTMLElement[]>([]);
  const indexRef = useRef(0);
  const token = useRef(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const collect = useCallback(() => {
    const root = rootRef.current;
    if (!root) return [];
    const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS));
    return all.filter((el) => (el.innerText || "").trim().length > 1 && !all.some((other) => other !== el && el.contains(other)));
  }, [rootRef]);

  const mark = (i: number) => {
    blocks.current.forEach((el, n) => el.classList.toggle("mw-speaking", n === i));
    blocks.current[i]?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const speakFrom = useCallback(
    (i: number) => {
      if (!canSpeak()) return;
      const synth = window.speechSynthesis;
      const my = ++token.current;
      synth.cancel();
      if (!blocks.current.length) blocks.current = collect();
      const total = blocks.current.length;
      if (i >= total) {
        setState({ active: false, playing: false, index: 0, total });
        mark(-1);
        return;
      }
      indexRef.current = i;
      mark(i);
      setState({ active: true, playing: true, index: i, total });
      const utter = new SpeechSynthesisUtterance(blocks.current[i].innerText.trim());
      utter.rate = rateRef.current;
      if (lang) {
        utter.lang = lang;
        const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
        if (voice) utter.voice = voice;
      }
      utter.onend = () => {
        if (token.current === my) speakFrom(i + 1);
      };
      utter.onerror = () => {
        if (token.current === my) setState((s) => ({ ...s, playing: false }));
      };
      synth.speak(utter);
    },
    [collect, lang],
  );

  useEffect(() => {
    if (state.playing) speakFrom(indexRef.current);
  }, [rate]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...state,
    play: (from?: number) => {
      blocks.current = collect();
      speakFrom(from ?? indexRef.current);
    },
    pause: () => {
      token.current++;
      window.speechSynthesis?.cancel();
      setState((s) => ({ ...s, playing: false }));
    },
    next: () => speakFrom(indexRef.current + 1),
    jumpTo: (el: HTMLElement) => {
      const i = blocks.current.indexOf(el);
      if (i >= 0) speakFrom(i);
    },
    stop: () => {
      token.current++;
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      mark(-1);
      setState({ active: false, playing: false, index: 0, total: 0 });
    },
  };
}
