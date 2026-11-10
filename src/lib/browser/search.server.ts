import { massSearch } from "@/lib/browser/masssearch.server";

/** Web search for the agent tools, powered by Mass Search (independent indexes; never Bing or Google). */
export type Source = { n: number; title: string; url: string; snippet: string };

export async function webSearch(query: string, request: Request): Promise<Source[]> {
  const found = await massSearch(query, request, 1);
  const out: Source[] = [];
  if (found.instant) out.push({ n: 1, title: found.instant.title, url: "", snippet: found.instant.body });
  if (found.card) out.push({ n: out.length + 1, title: found.card.title, url: found.card.url, snippet: found.card.extract });
  for (const r of found.results) {
    if (out.length >= 8) break;
    out.push({ n: out.length + 1, title: r.title, url: r.url, snippet: r.snippet });
  }
  return out;
}
