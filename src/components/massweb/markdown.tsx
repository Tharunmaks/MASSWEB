import { Fragment, type ReactNode } from "react";

/**
 * A small, safe Markdown renderer for AI answers: paragraphs, headings, lists, code, bold,
 * italic, links and [1]-style citations. It builds React elements, so model output can never
 * inject HTML into the browser shell.
 */
export function Markdown({ text, onCite, onLink }: { text: string; onCite?: (n: number) => void; onLink?: (url: string) => void }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-xl bg-stone p-3 font-mono text-[12.5px] leading-relaxed">
          {body.join("\n")}
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={key++} className="mt-3 mb-1 font-semibold">
          {inline(heading[2], onCite, onLink)}
        </p>,
      );
      i += 1;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className={`my-1.5 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, onCite, onLink)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={key++} className="my-1.5">
        {inline(para.join(" "), onCite, onLink)}
      </p>,
    );
  }
  return <>{blocks}</>;
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|\[\d{1,2}\](?:\[\d{1,2}\])*)/g;

function inline(text: string, onCite?: (n: number) => void, onLink?: (url: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);
    if (token.startsWith("`")) {
      out.push(
        <code key={key++} className="rounded bg-stone px-1 py-0.5 font-mono text-[0.88em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (match[2]) {
      const label = token.slice(1, token.indexOf("]("));
      const url = match[2];
      out.push(
        <button key={key++} type="button" onClick={() => onLink?.(url)} className="text-cobalt underline underline-offset-2">
          {label}
        </button>,
      );
    } else {
      for (const cite of token.matchAll(/\[(\d{1,2})\]/g)) {
        const n = Number(cite[1]);
        out.push(
          <button
            key={key++}
            type="button"
            aria-label={`Source ${n}`}
            onClick={() => onCite?.(n)}
            className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-md bg-cobalt/12 px-1 align-middle text-[10.5px] font-semibold text-cobalt"
          >
            {n}
          </button>,
        );
      }
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}
