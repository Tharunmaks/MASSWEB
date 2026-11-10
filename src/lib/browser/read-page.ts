import { createServerFn } from "@tanstack/react-start";
import { extractDocument, looksBlocked } from "./extract";
import type { PageRead, ReadResult } from "./types";

const MAX_BYTES = 900_000;
const MAX_HOPS = 5;

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if ([a, b, Number(match[3]), Number(match[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function parseTarget(raw: string): URL {
  const trimmed = raw.trim();
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new Error("That address is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http and https pages can be read.");
  }
  if (url.username || url.password) {
    throw new Error("Addresses with embedded credentials are not allowed.");
  }
  if (blockedHost(url.hostname)) {
    throw new Error("That address is not a public page.");
  }
  return url;
}

async function readBody(response: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", bytes: 0, truncated: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (bytes + value.byteLength > MAX_BYTES) {
      chunks.push(value.subarray(0, MAX_BYTES - bytes));
      bytes = MAX_BYTES;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytes += value.byteLength;
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), bytes, truncated };
}

async function fetchPublic(start: URL): Promise<{
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
  bytes: number;
  truncated: boolean;
}> {
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (blockedHost(current.hostname)) {
      throw new Error("The page redirected to a non-public address.");
    }
    const response = await fetch(current.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "accept-language": "en",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The page redirected without a destination.");
      current = new URL(location, current);
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new Error("The page redirected off the public web.");
      }
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = await readBody(response);
    return {
      finalUrl: current.href,
      status: response.status,
      contentType,
      html: body.text,
      bytes: body.bytes,
      truncated: body.truncated,
    };
  }
  throw new Error("The page redirected too many times.");
}

export const readPage = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object" || !("url" in data)) {
      throw new Error("Missing url.");
    }
    const url = (data as { url: unknown }).url;
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error("Enter an address.");
    }
    if (url.length > 2000) throw new Error("That address is too long.");
    return { url: url.trim() };
  })
  .handler(async ({ data }): Promise<ReadResult> => {
    const started = Date.now();
    try {
      const target = parseTarget(data.url);
      const fetched = await fetchPublic(target);
      const type = fetched.contentType.toLowerCase();
      const isHtml = type.includes("html") || type.includes("xml") || type === "";
      const isText = type.startsWith("text/") || type.includes("json") || type.includes("javascript");
      if (!isHtml && !isText) {
        const page: PageRead = {
          url: target.href,
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          contentType: fetched.contentType || "unknown",
          title: new URL(fetched.finalUrl).hostname,
          description: "",
          blocked: fetched.status >= 400,
          blockReason: fetched.status >= 400 ? `The site refused the read (${fetched.status}).` : null,
          headings: [],
          links: [],
          blocks: [
            {
              type: "p",
              text: `This address returned ${fetched.contentType || "a non-text file"} (${fetched.bytes} bytes), not a page an agent can read.`,
            },
          ],
          text: "",
          bytes: fetched.bytes,
          ms: Date.now() - started,
          truncated: fetched.truncated,
        };
        return { ok: true, page };
      }

      const extracted = isHtml
        ? extractDocument(fetched.html, fetched.finalUrl)
        : {
            title: new URL(fetched.finalUrl).hostname,
            description: "",
            links: [],
            headings: [],
            blocks: fetched.html
              .slice(0, 12000)
              .split(/\n{2,}/)
              .map((part) => part.replace(/\s+/g, " ").trim())
              .filter((part) => part.length > 24)
              .slice(0, 40)
              .map((text) => ({ type: "p" as const, text })),
            text: fetched.html.slice(0, 14000),
          };

      const blockReason = looksBlocked(fetched.status, fetched.html, extracted.title);
      const page: PageRead = {
        url: target.href,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        contentType: fetched.contentType || (isHtml ? "text/html" : "text/plain"),
        title: extracted.title || new URL(fetched.finalUrl).hostname,
        description: extracted.description,
        blocked: Boolean(blockReason) || fetched.status >= 400,
        blockReason:
          blockReason || (fetched.status >= 400 ? `The site refused the read (${fetched.status}).` : null),
        headings: extracted.headings,
        links: extracted.links,
        blocks: extracted.blocks,
        text: extracted.text,
        bytes: fetched.bytes,
        ms: Date.now() - started,
        truncated: fetched.truncated,
      };
      return { ok: true, page };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The read failed.";
      if (message.includes("timeout") || message.includes("aborted")) {
        return { ok: false, error: "The site took too long to answer." };
      }
      return { ok: false, error: message };
    }
  });
