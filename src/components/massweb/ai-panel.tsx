import { ArrowUp, Check, Copy, Globe, Layers, Plus, RotateCw, Sparkles, Square, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AiBody, type Source, streamAi } from "@/lib/browser/ai";
import { hostOf } from "@/lib/browser/destination";
import { canSpeak, copyText, haptic } from "@/lib/browser/device";
import { type Skill, useBrowser } from "@/lib/browser/state";
import { toast } from "@/lib/browser/toast";
import { Markdown } from "./markdown";
import { Sheet, SiteIcon } from "./ui";

export type AiContext =
  | { kind: "page"; url: string; title: string; prompt?: string }
  | { kind: "selection"; url: string; title: string; selection: string; prompt?: string }
  | { kind: "link"; url: string; title: string; prompt?: string }
  | { kind: "search"; query: string };

type Msg = { role: "user" | "assistant"; content: string; sources?: Source[]; error?: string; label?: string };

const QUICK = [
  { name: "Summarize", prompt: "Summarize this page in 5 short bullet points, then one line on why it matters." },
  { name: "Key points", prompt: "What are the most important points? Be concise." },
  { name: "Ask a question", prompt: "" },
];

export function AiPanel({
  context,
  onClose,
  getPageText,
  onOpenUrl,
}: {
  context: AiContext | null;
  onClose: () => void;
  getPageText: () => Promise<{ title: string; text: string } | null>;
  onOpenUrl: (url: string) => void;
}) {
  const tabs = useBrowser((s) => s.tabs);
  const skills = useBrowser((s) => s.skills);
  const settings = useBrowser((s) => s.settings);
  const usage = useBrowser((s) => s.aiUsage);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [withTabs, setWithTabs] = useState<string[]>([]);
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const pageText = useRef<{ title: string; text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef<string>("");

  const otherTabs = useMemo(
    () => (context && context.kind !== "search" ? tabs.filter((t) => t.url && t.url !== context.url && !t.archivedAt && !t.incognito).slice(-8).reverse() : []),
    [tabs, context],
  );

  const contextKey = context ? JSON.stringify(context) : "";
  useEffect(() => {
    abort.current?.abort();
    setMessages([]);
    setInput("");
    setBusy(false);
    setWithTabs([]);
    pageText.current = null;
    started.current = "";
  }, [contextKey]);

  useEffect(() => {
    if (!context || started.current === contextKey) return;
    started.current = contextKey;
    const auto = context.kind === "search" ? context.query : context.prompt;
    if (auto) void ask(auto, context.kind === "search" ? undefined : auto.length > 60 ? auto.slice(0, 57) + "…" : undefined);
  }, [contextKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [messages, busy]);

  useEffect(() => () => abort.current?.abort(), []);

  async function ask(prompt: string, label?: string) {
    if (!context || !prompt.trim() || busy) return;
    if (!useBrowser.getState().useAi()) {
      setMessages((m) => [...m, { role: "user", content: prompt, label }, { role: "assistant", content: "", error: `You've reached today's limit of ${settings.aiDailyLimit} AI requests. You can raise it in Settings.` }]);
      return;
    }
    haptic(6);
    const history: Msg[] = [...messages.filter((m) => !m.error), { role: "user", content: prompt, label }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;

    const body: AiBody = { mode: "page", messages: history.map((m) => ({ role: m.role, content: m.content })), lang: settings.translateTo };
    if (context.kind === "search") {
      body.mode = "search";
      body.query = prompt;
    } else if (context.kind === "link") {
      body.mode = "tabs";
      body.tabs = [{ url: context.url, title: context.title }];
    } else if (withTabs.length) {
      body.mode = "tabs";
      const picked = tabs.filter((t) => withTabs.includes(t.id) && t.url).map((t) => ({ url: t.url!, title: t.title }));
      body.tabs = [{ url: context.url, title: context.title }, ...picked];
    } else {
      if (!pageText.current) pageText.current = await getPageText();
      const page = pageText.current;
      const selection = context.kind === "selection" ? `Passage the user selected:\n"${context.selection}"\n\nFull page:\n` : "";
      body.page = { url: context.url, title: page?.title || context.title, text: selection + (page?.text || "(The page text couldn't be read; answer from the title and selection only.)") };
    }

    let answer = "";
    let sources: Source[] | undefined;
    let error: string | undefined;
    await streamAi(
      body,
      (event) => {
        if (event.type === "sources") sources = event.sources;
        else if (event.type === "delta") answer += event.text;
        else if (event.type === "error") error = event.message;
        setMessages((list) => {
          const next = list.slice();
          next[next.length - 1] = { role: "assistant", content: answer, sources, error };
          return next;
        });
      },
      ac.signal,
    );
    if (ac.signal.aborted && !answer) {
      setMessages((list) => list.slice(0, -2));
      setInput(prompt);
    }
    setBusy(false);
  }

  function stop() {
    abort.current?.abort();
    setBusy(false);
  }

  function speak(text: string) {
    if (!canSpeak()) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text.replace(/\[\d+\]/g, "").replace(/[*#`]/g, ""));
    utter.rate = settings.voiceRate;
    window.speechSynthesis.speak(utter);
  }

  const title =
    context?.kind === "search"
      ? "Web answer"
      : context?.kind === "link"
        ? `About ${hostOf(context.url)}`
        : context?.kind === "selection"
          ? "Selected text"
          : context?.title || "This page";
  const lastSources = [...messages].reverse().find((m) => m.sources?.length)?.sources ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const used = usage.day === today ? usage.count : 0;

  return (
    <Sheet
      open={!!context}
      onClose={() => {
        stop();
        onClose();
      }}
      height="full"
      label="Ask Grok"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink text-paper">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] leading-tight">{title}</span>
            <span className="block text-[11px] font-normal text-mute">
              Grok · {used}/{settings.aiDailyLimit} today
            </span>
          </span>
        </span>
      }
      actions={
        messages.length ? (
          <button
            type="button"
            aria-label="New chat"
            onClick={() => {
              stop();
              setMessages([]);
            }}
            className="mw-press flex h-10 w-10 items-center justify-center rounded-full text-mute"
          >
            <RotateCw className="h-[18px] w-[18px]" />
          </button>
        ) : null
      }
    >
      <div className="-mx-5 flex h-full flex-col">
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
          {context && context.kind !== "search" && context.kind !== "link" ? (
            <div className="mw-noscroll -mx-5 flex gap-2 overflow-x-auto px-5 pb-3">
              <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-xs text-paper">
                <SiteIcon url={context.url} size={14} /> {context.kind === "selection" ? "Selection + page" : "This page"}
              </span>
              {otherTabs.map((tab) => {
                const on = withTabs.includes(tab.id);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setWithTabs((list) => (on ? list.filter((id) => id !== tab.id) : [...list, tab.id].slice(-5)))}
                    className={`mw-press flex h-9 max-w-48 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs ${on ? "bg-cobalt text-white" : "bg-stone"}`}
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    <span className="truncate">{tab.title || hostOf(tab.url)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {messages.length === 0 && context && context.kind !== "search" ? (
            <div className="mw-rise pt-2 pb-4">
              <p className="text-sm text-mute">
                {withTabs.length ? `Ask about this page and ${withTabs.length} other tab${withTabs.length > 1 ? "s" : ""}.` : "Ask anything about this page, or tap a shortcut."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q.name}
                    type="button"
                    onClick={() => (q.prompt ? ask(withTabs.length && q.name === "Summarize" ? "Summarize and compare these pages. Cite them like [1]." : q.prompt, q.name) : inputRef.current?.focus())}
                    className="mw-press h-10 rounded-full bg-card px-4 text-sm shadow-ring"
                  >
                    {q.name}
                  </button>
                ))}
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => ask(skill.prompt, skill.name)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setEditing(skill);
                    }}
                    className="mw-press flex h-10 items-center gap-1.5 rounded-full bg-cobalt/10 px-4 text-sm text-cobalt"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {skill.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEditing({ name: "", prompt: "" })}
                  className="mw-press flex h-10 items-center gap-1 rounded-full border border-dashed border-rule px-3 text-sm text-mute"
                >
                  <Plus className="h-4 w-4" /> Skill
                </button>
              </div>
              <p className="mt-3 text-xs text-mute">Skills are your saved one-tap prompts. Long-press one to edit it.</p>
            </div>
          ) : null}

          <div className="space-y-4 pb-4">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="mw-pop max-w-[85%] rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-paper">{msg.label || msg.content}</div>
                </div>
              ) : (
                <div key={i} className="mw-rise text-[15px] leading-relaxed">
                  {msg.sources?.length ? (
                    <div className="mw-noscroll -mx-5 mb-2 flex gap-2 overflow-x-auto px-5">
                      {msg.sources.map((s) => (
                        <button
                          key={s.n}
                          type="button"
                          onClick={() => onOpenUrl(s.url)}
                          className="mw-press flex w-44 shrink-0 flex-col gap-1 rounded-2xl bg-card p-2.5 text-left shadow-ring"
                        >
                          <span className="flex items-center gap-1.5 text-[11px] text-mute">
                            <SiteIcon url={s.url} size={12} />
                            <span className="truncate">{hostOf(s.url)}</span>
                            <span className="ml-auto font-semibold text-cobalt">{s.n}</span>
                          </span>
                          <span className="line-clamp-2 text-xs leading-snug font-medium">{s.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {msg.error ? (
                    <p className="rounded-2xl bg-ember/10 px-4 py-3 text-sm text-ember">{msg.error}</p>
                  ) : msg.content ? (
                    <Markdown
                      text={msg.content}
                      onCite={(n) => {
                        const src = (msg.sources ?? lastSources).find((s) => s.n === n);
                        if (src) onOpenUrl(src.url);
                      }}
                      onLink={onOpenUrl}
                    />
                  ) : (
                    <Thinking search={context?.kind === "search" || !!withTabs.length || context?.kind === "link"} />
                  )}
                  {msg.content && !(busy && i === messages.length - 1) ? (
                    <div className="mt-1 flex gap-1 text-mute">
                      <button
                        type="button"
                        aria-label="Copy answer"
                        onClick={async () => (await copyText(msg.content)) && toast("Answer copied")}
                        className="mw-press flex h-9 w-9 items-center justify-center rounded-full"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      {canSpeak() ? (
                        <button type="button" aria-label="Read answer aloud" onClick={() => speak(msg.content)} className="mw-press flex h-9 w-9 items-center justify-center rounded-full">
                          <Volume2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ),
            )}
          </div>
        </div>

        <form
          className="shrink-0 border-t border-rule/60 bg-card px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-[24px] bg-stone py-1.5 pr-1.5 pl-4">
            <label htmlFor="ai-input" className="sr-only">
              Ask Grok
            </label>
            <textarea
              id="ai-input"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(140, event.target.scrollHeight)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(input);
                }
              }}
              placeholder={context?.kind === "search" ? "Ask a follow-up…" : withTabs.length ? "Ask about these tabs…" : "Ask about this page…"}
              className="max-h-36 min-h-9 flex-1 resize-none bg-transparent py-2 text-base outline-none placeholder:text-mute"
            />
            {busy ? (
              <button type="button" aria-label="Stop" onClick={stop} className="mw-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim()}
                className="mw-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper disabled:opacity-30"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </div>
          <p className="px-2 pt-1.5 text-center text-[10.5px] text-mute">Grok can make mistakes. Check important facts with the sources.</p>
        </form>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit skill" : "New skill"} label="Skill">
        {editing ? (
          <form
            className="space-y-3 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!editing.prompt?.trim()) return;
              useBrowser.getState().saveSkill({ id: editing.id, name: editing.name || "Skill", prompt: editing.prompt });
              setEditing(null);
              toast("Skill saved");
            }}
          >
            <label className="block">
              <span className="text-sm text-mute">Name</span>
              <input
                value={editing.name ?? ""}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="e.g. Find the price"
                className="mt-1 h-12 w-full rounded-xl bg-stone px-4 text-base outline-none focus:ring-2 focus:ring-cobalt"
              />
            </label>
            <label className="block">
              <span className="text-sm text-mute">What Grok should do with the page</span>
              <textarea
                value={editing.prompt ?? ""}
                onChange={(event) => setEditing({ ...editing, prompt: event.target.value })}
                placeholder="e.g. Find the product's price, delivery time and return policy."
                className="mt-1 h-28 w-full rounded-xl bg-stone p-3 text-base outline-none focus:ring-2 focus:ring-cobalt"
              />
            </label>
            <div className="flex gap-2">
              {editing.id ? (
                <button
                  type="button"
                  onClick={() => {
                    useBrowser.getState().removeSkill(editing.id!);
                    setEditing(null);
                  }}
                  className="mw-press flex h-12 items-center gap-2 rounded-full px-4 text-sm text-ember"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              ) : null}
              <button type="submit" className="mw-press ml-auto h-12 rounded-full bg-ink px-6 text-sm font-medium text-paper">
                Save skill
              </button>
            </div>
          </form>
        ) : null}
      </Sheet>
    </Sheet>
  );
}

function Thinking({ search }: { search: boolean }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-mute" role="status">
      {search ? <Globe className="h-4 w-4 animate-pulse" /> : <Layers className="h-4 w-4 animate-pulse" />}
      {search ? "Reading the web…" : "Reading the page…"}
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((n) => (
          <span key={n} className="h-1.5 w-1.5 animate-bounce rounded-full bg-mute" style={{ animationDelay: `${n * 120}ms` }} />
        ))}
      </span>
    </div>
  );
}

export function AiUnavailable({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="AI is off here" label="AI unavailable">
      <div className="pb-4 text-sm leading-relaxed text-mute">
        <p>
          Mass Web's AI runs on Grok, using the xAI key that the Grok app builder adds when you publish. This copy of Mass Web doesn't have that key, so Ask, Skills and
          Tidy Tabs are switched off.
        </p>
        <p className="mt-2">Publish the app from Grok and AI turns on by itself. Nothing else needs setting up.</p>
        <button type="button" onClick={onClose} className="mw-press mt-4 flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-paper">
          <X className="h-4 w-4" /> Close
        </button>
      </div>
    </Sheet>
  );
}
