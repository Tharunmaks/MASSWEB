/**
 * Page translation. Text is sent from the phone straight to Google Translate's public endpoint
 * (the one Chrome's dictionary extension uses), in batches. It's unofficial and free, so it can
 * rate-limit; callers show a friendly error when it does.
 */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "ml", name: "Malayalam" },
  { code: "hi", name: "Hindi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "kn", name: "Kannada" },
  { code: "bn", name: "Bengali" },
  { code: "mr", name: "Marathi" },
  { code: "ar", name: "Arabic" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh-CN", name: "Chinese" },
  { code: "ru", name: "Russian" },
  { code: "pt", name: "Portuguese" },
];

export function languageName(code: string): string {
  return LANGUAGES.find((lang) => lang.code === code)?.name ?? code;
}

const ENDPOINT = "https://translate.googleapis.com/translate_a/t";

async function translateChunk(texts: string[], to: string): Promise<{ texts: string[]; from: string }> {
  const body = new URLSearchParams();
  for (const text of texts) body.append("q", text);
  const res = await fetch(`${ENDPOINT}?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(to)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(res.status === 429 ? "The translation service is busy. Try again in a minute." : "Translation failed.");
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Translation failed.");
  let from = "";
  const out = data.map((item, index) => {
    if (typeof item === "string") return item;
    if (Array.isArray(item) && typeof item[0] === "string") {
      if (!from && typeof item[1] === "string") from = item[1];
      return item[0];
    }
    return texts[index];
  });
  // A single q comes back as a bare string or [text, lang] instead of a list of them.
  if (texts.length === 1 && typeof data[0] === "string" && typeof data[1] === "string" && data.length === 2) {
    return { texts: [data[0]], from: data[1] };
  }
  return { texts: out, from };
}

/** Translate many strings, reporting each finished chunk so the page can update progressively. */
export async function translateAll(
  texts: string[],
  to: string,
  onChunk: (start: number, translated: string[]) => void,
): Promise<string> {
  const chunks: { start: number; items: string[] }[] = [];
  let current: string[] = [];
  let size = 0;
  let start = 0;
  texts.forEach((text, index) => {
    const piece = text.slice(0, 1500);
    if (current.length && (current.length >= 60 || size + piece.length > 4000)) {
      chunks.push({ start, items: current });
      current = [];
      size = 0;
      start = index;
    }
    current.push(piece);
    size += piece.length;
  });
  if (current.length) chunks.push({ start, items: current });

  let from = "";
  let next = 0;
  let failure: Error | null = null;
  async function worker() {
    while (next < chunks.length && !failure) {
      const chunk = chunks[next++];
      try {
        const result = await translateChunk(chunk.items, to);
        if (!from) from = result.from;
        onChunk(chunk.start, result.texts);
      } catch (error) {
        failure = error instanceof Error ? error : new Error("Translation failed.");
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  if (failure && !from) throw failure;
  return from;
}
