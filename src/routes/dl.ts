import { createFileRoute } from "@tanstack/react-router";
import { fetchPublicStream, parsePublicUrl } from "@/lib/browser/proxy";

const MAX_DOWNLOAD = 200 * 1024 * 1024;

function filenameFor(url: URL, disposition: string | null, type: string): string {
  const fromHeader = disposition?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i)?.[1];
  let name = fromHeader ? decodeURIComponent(fromHeader) : decodeURIComponent(url.pathname.split("/").pop() || "");
  name = name.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 120);
  if (!name) name = url.hostname;
  if (!/\.[a-z0-9]{1,6}$/i.test(name)) {
    const ext = type.match(/(pdf|zip|png|jpe?g|gif|webp|mp4|mp3|json|csv|plain|html)/i)?.[1]?.toLowerCase();
    if (ext) name += `.${ext === "plain" ? "txt" : ext === "jpeg" ? "jpg" : ext}`;
  }
  return name;
}

/** Stream a file to the phone as a download (PDFs, zips, images, apks ...). */
export const Route = createFileRoute("/dl")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("u") || "";
        let target: URL;
        try {
          target = parsePublicUrl(raw);
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "Blocked address.", { status: 400 });
        }
        try {
          const { finalUrl, response } = await fetchPublicStream(target, request);
          if (!response.ok || !response.body) return new Response(`The site answered ${response.status}.`, { status: 502 });
          const size = Number(response.headers.get("content-length") || 0);
          if (size > MAX_DOWNLOAD) return new Response("That file is too big to download through Mass Web. Use Open in Chrome.", { status: 413 });
          const type = response.headers.get("content-type") || "application/octet-stream";
          const name = filenameFor(finalUrl, response.headers.get("content-disposition"), type);
          let sent = 0;
          const limited = response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                sent += chunk.byteLength;
                if (sent > MAX_DOWNLOAD) controller.error(new Error("Download too large."));
                else controller.enqueue(chunk);
              },
            }),
          );
          const headers: Record<string, string> = {
            "content-type": type,
            "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          };
          if (size) headers["content-length"] = String(size);
          return new Response(limited, { headers });
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "Download failed.", { status: 502 });
        }
      },
    },
  },
});
