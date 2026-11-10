/**
 * The GitHub Pages app lives on a different site than the page server, so every server
 * response allows cross-site reads and exposes Mass Web's own headers. Nothing here uses
 * cookies or logins, so allowing any origin is safe.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key",
  "access-control-expose-headers":
    "x-mw-final-url, x-mw-readable, x-mw-blocked, x-mw-trackers, x-mw-adblock, x-mw-status, x-mw-bytes, x-mw-type, content-disposition",
  "access-control-max-age": "86400",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
