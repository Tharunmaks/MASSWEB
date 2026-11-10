import { cleanUrl, unwrapRedirect } from "@/lib/browser/destination";

/**
 * Mass Search: Mass Web's own search results.
 *
 * Nothing here touches Bing or Google, and nothing is scraped: every source is an API that
 * allows automated use. Results come from Marginalia's independent index, Wikipedia,
 * DuckDuckGo Instant Answers, Hacker News and Stack Overflow, plus Brave's and Mojeek's
 * independent indexes through their official APIs when BRAVE_SEARCH_KEY / MOJEEK_API_KEY
 * are set. Lists are merged with reciprocal-rank fusion and topped with Mass Web's own
 * instant answers (calculator, definitions, a Wikipedia knowledge card).
 */

export type Source = { n: number; title: string; url: string; snippet: string; host: string; engines: string[] };
export type Card = { title: string; extract: string; url: string; image?: string };
export type Instant = { kind: "calc" | "define" | "time"; title: string; body: string; detail?: string };
export type SearchResult = {
  query: string;
  page: number;
  results: Source[];
  card: Card | null;
  instant: Instant | null;
  related: string[];
  engines: string[];
  took: number;
};

type Hit = { title: string; url: string; snippet: string };

const PER_PAGE = 10;

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

async function getJson<T>(url: string, headers: Record<string, string> = {}, ms = 5000): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "MassWeb/1 (+https://github.com/Tharunmaks/MASSWEB)", ...headers }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function normalizeHit(raw: string): string | null {
  let href = raw.trim().replace(/&amp;/g, "&");
  if (href.startsWith("//")) href = `https:${href}`;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const url = new URL(cleanUrl(unwrapRedirect(href)));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** The same page with and without "www." or a trailing slash counts once. */
function dedupeKey(href: string): string {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${url.search}`;
  } catch {
    return href;
  }
}

/* ------------------------------------------------------------------ engines */

type Engine = { name: string; run: (query: string, page: number, request: Request) => Promise<Hit[]> };

/** Brave Search's official API (independent index). Used when BRAVE_SEARCH_KEY is set. */
const brave: Engine = {
  name: "Brave",
  async run(query, page) {
    const key = process.env.BRAVE_SEARCH_KEY;
    if (!key) return [];
    const data = await getJson<{ web?: { results?: { url: string; title: string; description?: string }[] } }>(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&offset=${page - 1}`,
      { "x-subscription-token": key },
    );
    const hits: Hit[] = [];
    for (const item of data.web?.results || []) {
      const url = normalizeHit(item.url);
      if (url) hits.push({ title: stripTags(item.title || ""), url, snippet: stripTags(item.description || "").slice(0, 320) });
    }
    return hits;
  },
};

/** Mojeek's official API (independent UK index). Used when MOJEEK_API_KEY is set. */
const mojeek: Engine = {
  name: "Mojeek",
  async run(query, page) {
    const key = process.env.MOJEEK_API_KEY;
    if (!key) return [];
    const data = await getJson<{ response?: { results?: { url: string; title: string; desc?: string }[] } }>(
      `https://api.mojeek.com/search?q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(key)}&fmt=json&t=10&s=${(page - 1) * 10 + 1}`,
    );
    const hits: Hit[] = [];
    for (const item of data.response?.results || []) {
      const url = normalizeHit(item.url);
      if (url) hits.push({ title: stripTags(item.title || ""), url, snippet: stripTags(item.desc || "").slice(0, 320) });
    }
    return hits;
  },
};

/** DuckDuckGo's Instant Answer API: official sites and topic pages (its own data, not a web index). */
const instantLinks: Engine = {
  name: "Instant Answers",
  async run(query, page) {
    if (page > 1) return [];
    type Topic = { FirstURL?: string; Text?: string; Topics?: Topic[] };
    const data = await getJson<{ Results?: Topic[]; RelatedTopics?: Topic[]; AbstractURL?: string; Heading?: string; AbstractText?: string }>(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=massweb`,
      {},
      3500,
    );
    const hits: Hit[] = [];
    for (const item of data.Results || []) {
      const url = item.FirstURL ? normalizeHit(item.FirstURL) : null;
      if (url) hits.push({ title: item.Text || data.Heading || url, url, snippet: data.AbstractText ? data.AbstractText.slice(0, 320) : "Official site" });
    }
    return hits;
  },
};

/** Hacker News (Algolia's public API): what people in tech are linking to and discussing. */
const hackerNews: Engine = {
  name: "Hacker News",
  async run(query, page) {
    const data = await getJson<{ hits?: { title?: string; url?: string; objectID: string; points?: number; num_comments?: number; created_at?: string }[] }>(
      `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=5&page=${page - 1}&query=${encodeURIComponent(query)}`,
      {},
      3500,
    );
    const hits: Hit[] = [];
    for (const item of data.hits || []) {
      if (!item.title) continue;
      const url = normalizeHit(item.url || `https://news.ycombinator.com/item?id=${item.objectID}`);
      if (url) hits.push({ title: item.title, url, snippet: `${item.points ?? 0} points and ${item.num_comments ?? 0} comments on Hacker News${item.created_at ? ` · ${item.created_at.slice(0, 10)}` : ""}` });
    }
    return hits;
  },
};

/** Stack Exchange's public API: answered programming and how-to questions. */
const stackExchange: Engine = {
  name: "Stack Overflow",
  async run(query, page) {
    if (page > 1) return [];
    const data = await getJson<{ items?: { title: string; link: string; score: number; answer_count: number; is_answered: boolean }[] }>(
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=4&answers=1&q=${encodeURIComponent(query)}`,
      {},
      3500,
    );
    const hits: Hit[] = [];
    for (const item of data.items || []) {
      const url = normalizeHit(item.link);
      if (url) hits.push({ title: `${decodeEntities(item.title)} - Stack Overflow`, url, snippet: `${item.answer_count} answers · score ${item.score}` });
    }
    return hits;
  },
};

/** Marginalia: an independent index that favours small, text-heavy sites. Free "public" key, or MARGINALIA_API_KEY. */
const marginalia: Engine = {
  name: "Marginalia",
  async run(query, page) {
    if (page > 3) return [];
    const data = await getJson<{ results?: { url: string; title: string; description: string }[] }>(
      `https://api2.marginalia-search.com/search?query=${encodeURIComponent(query)}&count=10&page=${page}&timeout=3000`,
      { "API-Key": process.env.MARGINALIA_API_KEY || "public" },
      4500,
    );
    const hits: Hit[] = [];
    for (const item of data.results || []) {
      const url = normalizeHit(item.url);
      if (url) hits.push({ title: item.title || url, url, snippet: (item.description || "").slice(0, 320) });
    }
    return hits;
  },
};

/** Wikipedia's own search, so encyclopaedic answers are never missing. */
const wikipedia: Engine = {
  name: "Wikipedia",
  async run(query, page) {
    if (page > 1) return [];
    const data = await getJson<{ query?: { search?: { title: string; snippet: string }[] } }>(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(query)}`,
    );
    return (data.query?.search || []).map((item) => ({
      title: `${item.title} - Wikipedia`,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
      snippet: stripTags(item.snippet).slice(0, 320),
    }));
  },
};

const ENGINES: Engine[] = [brave, mojeek, marginalia, wikipedia, instantLinks, hackerNews, stackExchange];
/** Lower weight = a vote from this engine counts for less in the merged ranking. */
const WEIGHT: Record<string, number> = { Brave: 1, Mojeek: 0.9, Marginalia: 0.75, Wikipedia: 0.7, "Instant Answers": 1.2, "Hacker News": 0.4, "Stack Overflow": 0.4 };

function fuse(lists: { name: string; hits: Hit[] }[]): Source[] {
  const scores = new Map<string, { score: number; hit: Hit; engines: Set<string>; snippetLen: number }>();
  for (const { name, hits } of lists) {
    hits.forEach((hit, rank) => {
      const key = dedupeKey(hit.url);
      const vote = (WEIGHT[name] ?? 0.8) / (rank + 4);
      const entry = scores.get(key);
      if (entry) {
        entry.score += vote;
        entry.engines.add(name);
        if (hit.snippet.length > entry.snippetLen) {
          entry.hit = { ...entry.hit, snippet: hit.snippet, title: entry.hit.title || hit.title };
          entry.snippetLen = hit.snippet.length;
        }
      } else scores.set(key, { score: vote, hit, engines: new Set([name]), snippetLen: hit.snippet.length });
    });
  }
  // Agreement across engines is the strongest signal we have.
  return [...scores.values()]
    .map((entry) => ({ ...entry, score: entry.score * (1 + 0.35 * (entry.engines.size - 1)) }))
    .sort((a, b) => b.score - a.score)
    .map((entry, i) => ({
      n: i + 1,
      title: entry.hit.title || entry.hit.url,
      url: entry.hit.url,
      snippet: entry.hit.snippet,
      host: new URL(entry.hit.url).hostname.replace(/^www\./, ""),
      engines: [...entry.engines],
    }));
}

/* ------------------------------------------------------------ instant answers */

/** Arithmetic with + - * / ^ % and parentheses, evaluated without eval(). */
export function calculate(input: string): string | null {
  const expr = input
    .replace(/^(what is|what's|calculate|calc|solve)\s+/i, "")
    .replace(/\?$/, "")
    .replace(/×|x(?=\s*\d)/gi, "*")
    .replace(/÷/g, "/")
    .replace(/,/g, "")
    .trim();
  if (!/^[\d\s().+\-*/^%]+$/.test(expr) || !/\d/.test(expr) || !/[+\-*/^%]/.test(expr)) return null;
  const tokens = expr.match(/\d*\.?\d+(?:e[+-]?\d+)?|[()+\-*/^%]/gi);
  if (!tokens) return null;
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const parsePrimary = (): number => {
    const t = next();
    if (t === undefined) throw new Error("bad");
    if (t === "(") {
      const v = parseExpr();
      if (next() !== ")") throw new Error("bad");
      return v;
    }
    if (t === "-") return -parsePrimary();
    if (t === "+") return parsePrimary();
    if (/^[\d.]/.test(t)) return Number(t);
    throw new Error("bad");
  };
  const parsePow = (): number => {
    const base = parsePrimary();
    if (peek() === "^") {
      next();
      return base ** parsePow();
    }
    return base;
  };
  const parseTerm = (): number => {
    let v = parsePow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = parsePow();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const value = parseExpr();
    if (i !== tokens.length || !Number.isFinite(value)) return null;
    const rounded = Math.abs(value) < 1e15 ? Number(value.toPrecision(12)) : value;
    return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 });
  } catch {
    return null;
  }
}

async function define(word: string): Promise<Instant | null> {
  type Entry = { word: string; phonetic?: string; meanings?: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[] };
  try {
    const data = await getJson<Entry[]>(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {}, 3500);
    const entry = data[0];
    const meaning = entry?.meanings?.[0];
    const sense = meaning?.definitions?.[0];
    if (!entry || !meaning || !sense) return null;
    return {
      kind: "define",
      title: entry.word + (entry.phonetic ? `  ${entry.phonetic}` : ""),
      body: `${meaning.partOfSpeech}: ${sense.definition}`,
      detail: sense.example ? `"${sense.example}"` : undefined,
    };
  } catch {
    return null;
  }
}

function instantAnswer(query: string): Promise<Instant | null> {
  const q = query.trim();
  const calc = calculate(q);
  if (calc !== null) return Promise.resolve({ kind: "calc", title: calc, body: q.replace(/^(what is|what's|calculate|calc|solve)\s+/i, "").replace(/\?$/, "") });
  const def = q.match(/^(?:define|definition of|meaning of|what does)\s+([a-z][a-z'-]{1,40})(?:\s+mean)?\??$/i);
  if (def) return define(def[1].toLowerCase());
  if (/^(time|current time|what time is it)(\s+now)?\??$/i.test(q)) {
    const now = new Date();
    return Promise.resolve({ kind: "time", title: now.toUTCString().slice(17, 25) + " UTC", body: now.toUTCString().slice(0, 16), detail: "Your phone shows your local time in the status bar." });
  }
  return Promise.resolve(null);
}

async function knowledgeCard(query: string): Promise<Card | null> {
  const q = query.trim();
  if (q.length < 2 || q.length > 80 || /^[\d\s().+\-*/^%]+$/.test(q)) return null;
  if (/\b(how|why|vs|download|login|price|near me|reddit|github|site:)\b/i.test(q)) return null;
  try {
    const found = await getJson<{ query?: { search?: { title: string }[] } }>(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(q)}`,
      {},
      3500,
    );
    const title = found.query?.search?.[0]?.title;
    if (!title) return null;
    // Only show the card when the article clearly is about the query.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const a = norm(title);
    const b = norm(q);
    if (!(a === b || a.includes(b) || b.includes(a) || b.split(" ").filter((w) => w.length > 2).every((w) => a.includes(w)))) return null;
    const summary = await getJson<{ title: string; extract: string; thumbnail?: { source: string }; content_urls?: { mobile?: { page: string } } }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      {},
      3500,
    );
    if (!summary.extract || /may refer to/i.test(summary.extract)) return null;
    return {
      title: summary.title,
      extract: summary.extract.length > 420 ? `${summary.extract.slice(0, 417).replace(/\s+\S*$/, "")}…` : summary.extract,
      url: summary.content_urls?.mobile?.page || `https://en.m.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      image: summary.thumbnail?.source,
    };
  } catch {
    return null;
  }
}

async function relatedSearches(query: string): Promise<string[]> {
  try {
    const data = await getJson<unknown>(`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`, {}, 2500);
    if (Array.isArray(data) && Array.isArray(data[1])) return (data[1] as unknown[]).filter((s): s is string => typeof s === "string" && s.toLowerCase() !== query.toLowerCase()).slice(0, 6);
  } catch {
    /* no suggestions */
  }
  return [];
}

/* ----------------------------------------------------------------- the search */

export async function massSearch(query: string, request: Request, page = 1): Promise<SearchResult> {
  const started = Date.now();
  const q = query.trim().slice(0, 200);
  const pageNo = Math.min(Math.max(1, page | 0), 5);
  if (!q) return { query: q, page: pageNo, results: [], card: null, instant: null, related: [], engines: [], took: 0 };

  const engineRuns = ENGINES.map(async (engine) => {
    try {
      const hits = await engine.run(q, pageNo, request);
      return { name: engine.name, hits: hits.filter((h) => h.url) };
    } catch {
      return { name: engine.name, hits: [] as Hit[] };
    }
  });
  const [lists, instant, card, related] = await Promise.all([
    Promise.all(engineRuns),
    pageNo === 1 ? instantAnswer(q) : Promise.resolve(null),
    pageNo === 1 ? knowledgeCard(q) : Promise.resolve(null),
    pageNo === 1 ? relatedSearches(q) : Promise.resolve([]),
  ]);
  const results = fuse(lists).slice(0, PER_PAGE);
  // Don't repeat the knowledge card as the first result.
  const trimmed = card ? results.filter((r) => dedupeKey(r.url) !== dedupeKey(card.url.replace("en.m.wikipedia", "en.wikipedia"))) : results;
  trimmed.forEach((r, i) => (r.n = i + 1));
  return {
    query: q,
    page: pageNo,
    results: trimmed,
    card,
    instant,
    related,
    engines: lists.filter((l) => l.hits.length).map((l) => l.name),
    took: Date.now() - started,
  };
}
