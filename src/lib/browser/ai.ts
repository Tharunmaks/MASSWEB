import { appPrefix } from "@/lib/browser/offline";

export type Source = { n: number; title: string; url: string; snippet: string };
export type AiEvent = { type: "sources"; sources: Source[] } | { type: "delta"; text: string } | { type: "done" } | { type: "error"; message: string };
export type AiBody = {
  mode: "page" | "tabs" | "search";
  messages: { role: "user" | "assistant"; content: string }[];
  page?: { url: string; title: string; text: string };
  tabs?: { url: string; title: string }[];
  query?: string;
  lang?: string;
};

let status: Promise<boolean> | null = null;

/** Whether this deployment has Grok switched on (the platform injects the key on deploy). */
export function aiStatus(): Promise<boolean> {
  if (!status) {
    status = fetch(`${appPrefix()}/ai`)
      .then((res) => res.json() as Promise<{ available?: boolean }>)
      .then((data) => !!data.available)
      .catch(() => false);
  }
  return status;
}

export async function streamAi(body: AiBody, onEvent: (event: AiEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${appPrefix()}/ai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal.aborted) return;
    onEvent({ type: "error", message: "Couldn't reach the AI. Check your connection." });
    return;
  }
  if (!res.ok || !res.body) {
    let message = "The AI request failed.";
    try {
      message = ((await res.json()) as { error?: string }).error || message;
    } catch {
      /* not json */
    }
    onEvent({ type: "error", message });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as AiEvent);
        } catch {
          /* skip malformed line */
        }
      }
    }
  } catch {
    if (!signal.aborted) onEvent({ type: "error", message: "The answer was cut off." });
  }
}

export async function tidyTabs(tabs: { url: string; title: string }[]): Promise<{ name: string; emoji: string; tabs: number[] }[]> {
  const res = await fetch(`${appPrefix()}/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "tidy", messages: [], tabs }),
  });
  const data = (await res.json()) as { groups?: { name: string; emoji: string; tabs: number[] }[]; error?: string };
  if (!res.ok || !data.groups) throw new Error(data.error || "Couldn't organise tabs.");
  return data.groups;
}

/** Questions get an "Ask Grok" suggestion first in the address bar. */
export function looksLikeQuestion(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (q.length < 6 || !/\s/.test(q)) return false;
  return q.endsWith("?") || /^(what|why|how|who|whom|whose|when|where|which|is|are|can|could|should|would|will|do|does|did|explain|compare|tell me|give me|summari[sz]e|best|top)\b/.test(q);
}
