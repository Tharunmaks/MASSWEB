import type { ImageResult, SearchResult, Source } from "@/lib/browser/masssearch.server";

/** The Mass Search results page, as HTML. Works standalone (/search) and inside Mass Web (mass://search). */

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

function searchHref(query: string, page: number, embedded: boolean, images = false): string {
  const qs = `q=${encodeURIComponent(query)}${images ? "&t=images" : ""}${page > 1 ? `&p=${page}` : ""}`;
  return embedded ? `mass://search?${qs}` : `/search?${qs}`;
}

function highlight(text: string, query: string): string {
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length > 2))];
  if (!words.length) return esc(text);
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text
    .split(pattern)
    .map((part, i) => (i % 2 ? `<b>${esc(part)}</b>` : esc(part)))
    .join("");
}

function crumb(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/$/, "").split("/").filter(Boolean).slice(0, 3);
    return [u.hostname.replace(/^www\./, ""), ...path].join(" › ");
  } catch {
    return url;
  }
}

/** A site's logo from Mass Web's own /icon service, with its first letter underneath as the fallback. */
function logo(host: string, origin: string): string {
  const letter = host.replace(/^www\./, "").slice(0, 1).toUpperCase();
  return `<span class="fav" aria-hidden="true">${esc(letter)}<img src="${esc(origin)}/icon?host=${encodeURIComponent(host)}" alt="" loading="lazy" decoding="async" onload="this.parentNode.classList.add('ok')" onerror="this.remove()"></span>`;
}

function resultItem(r: Source, query: string, origin: string): string {
  return `<li class="r">
  <a class="rl" href="${esc(r.url)}">
    <div class="rh">${logo(r.host, origin)}<span class="crumb">${esc(crumb(r.url))}</span></div>
    <h3>${highlight(r.title, query)}</h3>
    ${r.snippet ? `<p>${highlight(r.snippet, query)}</p>` : ""}
  </a>
</li>`;
}

export function renderSearchPage(data: SearchResult, options: { dark: boolean; embedded: boolean; origin: string; images?: ImageResult }): string {
  const { query, page, results, card, instant, related } = data;
  const { origin, images } = options;
  const engines = images ? images.engines : data.engines;
  const { dark, embedded } = options;
  const title = query ? `${query} - Mass Search${options.images ? " images" : ""}` : "Mass Search";
  const canonical = searchHref(query, page, false);

  const instantHtml = instant
    ? `<section class="card instant ${instant.kind}">
  <div class="big">${esc(instant.title)}</div>
  <div class="small">${esc(instant.body)}</div>
  ${instant.detail ? `<div class="detail">${esc(instant.detail)}</div>` : ""}
</section>`
    : "";

  const cardHtml = card
    ? `<section class="card know">
  ${card.image ? `<img src="${esc(card.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
  <div>
    <h2>${esc(card.title)}</h2>
    <p>${esc(card.extract)}</p>
    <a href="${esc(card.url)}">Wikipedia</a>
  </div>
</section>`
    : "";

  const list = results.length
    ? `<ol class="results">${results.map((r) => resultItem(r, query, origin)).join("")}</ol>`
    : query
      ? `<section class="empty"><h2>No results${page > 1 ? " on this page" : ""}</h2><p>${
          engines.length ? "Try different words, or fewer of them." : "The search indexes didn't answer in time. Pull down to try again."
        }</p></section>`
      : "";

  const relatedHtml = related.length
    ? `<section class="related"><h4>Related searches</h4><div class="chips">${related
        .map((s) => `<a class="chip" href="${esc(searchHref(s, 1, embedded))}">${esc(s)}</a>`)
        .join("")}</div></section>`
    : "";

  const shown = images ? images.images.length : results.length;
  const pager = query
    ? `<nav class="pager">${page > 1 ? `<a class="btn" href="${esc(searchHref(query, page - 1, embedded, !!images))}">‹ Previous</a>` : "<span></span>"}<span class="pn">Page ${page}</span>${
        shown >= 6 && page < 5 ? `<a class="btn" href="${esc(searchHref(query, page + 1, embedded, !!images))}">Next ›</a>` : "<span></span>"
      }</nav>`
    : "";

  const tabs = query
    ? `<nav class="tabs"><a class="tab${images ? "" : " on"}" href="${esc(searchHref(query, 1, embedded))}">All</a><a class="tab${images ? " on" : ""}" href="${esc(searchHref(query, 1, embedded, true))}">Images</a></nav>`
    : "";

  const grid = images
    ? images.images.length
      ? `<div class="grid">${images.images
          .map(
            (im) => `<a class="im" href="${esc(im.page)}" title="${esc(im.title)}">
  <img src="${esc(im.thumb)}" alt="${esc(im.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.im').remove()">
  <span class="cap">${logo(im.host, origin)}<span class="ct">${esc(im.title || im.host)}</span></span>
  <span class="src">${esc(im.host)}${im.license ? ` · ${esc(im.license)}` : ""}</span>
</a>`,
          )
          .join("")}</div>`
      : `<section class="empty"><h2>No images${page > 1 ? " on this page" : ""}</h2><p>Try different words, or fewer of them.</p></section>`
    : "";

  const home = !query
    ? `<section class="hero"><div class="logo"><span>M</span></div><h1>Mass Search</h1><p>Open sources, no ads, no tracking. Built into Mass Web.</p></section>`
    : "";

  const bridge = embedded
    ? `(function(){
  function post(m){m.source="massweb";try{parent.postMessage(m,"*")}catch(e){}}
  post({type:"title",title:document.title});
  document.addEventListener("click",function(e){
    var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;
    var h=a.getAttribute("href");if(!h)return;
    e.preventDefault();post({type:"open",href:h});
  },true);
  var f=document.getElementById("f");if(f)f.addEventListener("submit",function(e){e.preventDefault();var q=f.q.value.trim();if(q)post({type:"open",href:"mass://search?q="+encodeURIComponent(q)+(f.t?"&t=images":"")})});
  document.addEventListener("selectionchange",function(){var s=String(document.getSelection()||"").trim();post({type:"selection",text:s.slice(0,2000)})});
})();`
    : `(function(){var f=document.getElementById("f");if(f)f.q.focus();})();`;

  return `<!doctype html>
<html lang="en"${dark ? ' data-theme="dark"' : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
${embedded ? "" : `<link rel="canonical" href="${esc(canonical)}"><link rel="search" type="application/opensearchdescription+xml" title="Mass Search" href="/opensearch.xml"><link rel="icon" href="/favicon.svg" type="image/svg+xml">`}
<style>
:root{--bg:#f5f0e6;--card:#fffdf8;--ink:#17140f;--mute:#6f675c;--rule:#d3c9b8;--stone:#e8e0d2;--cobalt:#2453d6;--ember:#e0592a;color-scheme:light}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#181613;--card:#221f1b;--ink:#f2ece1;--mute:#a39a8d;--rule:#403a33;--stone:#2c2823;--cobalt:#7ea0ff;--ember:#ff8a5c;color-scheme:dark}}
:root[data-theme=dark]{--bg:#181613;--card:#221f1b;--ink:#f2ece1;--mute:#a39a8d;--rule:#403a33;--stone:#2c2823;--cobalt:#7ea0ff;--ember:#ff8a5c;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
a{color:inherit;text-decoration:none}
main{max-width:680px;margin:0 auto;padding:12px 16px 40px}
form{display:flex;align-items:center;gap:8px;height:48px;padding:0 6px 0 14px;border-radius:999px;background:var(--card);box-shadow:0 0 0 1px rgb(23 20 15/.1),0 1px 2px -1px rgb(23 20 15/.06),0 8px 24px rgb(23 20 15/.06)}
form .m{width:26px;height:26px;border-radius:8px;background:var(--cobalt);color:#fff;display:grid;place-items:center;font-weight:600;font-size:14px;flex:none}
form input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:17px}
form button{height:38px;padding:0 16px;border:0;border-radius:999px;background:var(--ink);color:var(--bg);font:inherit;font-weight:500}
.meta{margin:10px 2px 6px;font-size:12.5px;color:var(--mute);display:flex;justify-content:space-between;gap:12px}
.card{background:var(--card);border-radius:18px;padding:16px;margin:10px 0;box-shadow:0 0 0 1px rgb(23 20 15/.08)}
.instant .big{font-size:30px;font-weight:600;letter-spacing:-.02em;overflow-wrap:anywhere}
.instant .small{color:var(--mute);margin-top:2px}
.instant .detail{margin-top:8px;font-style:italic;color:var(--mute)}
.instant.define .big{font-size:22px}
.know{display:flex;gap:14px;align-items:flex-start}
.know img{width:84px;height:84px;object-fit:cover;border-radius:12px;flex:none;background:var(--stone)}
.know h2{margin:0 0 4px;font-size:18px;font-weight:600;letter-spacing:-.01em}
.know p{margin:0;font-size:14.5px;color:var(--ink);opacity:.9}
.know a{display:inline-block;margin-top:8px;color:var(--cobalt);font-size:13.5px;font-weight:500}
ol.results{list-style:none;margin:6px 0 0;padding:0}
.r{border-bottom:1px solid var(--rule)}
.r:last-child{border-bottom:0}
.rl{display:block;padding:14px 2px}
.rl:active{opacity:.7}
.rh{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--mute);min-width:0}
.crumb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fav{position:relative;width:20px;height:20px;border-radius:6px;background:var(--stone);display:grid;place-items:center;font-size:11px;font-weight:600;color:var(--ink);flex:none;overflow:hidden}
.fav img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0}
.fav.ok{background:transparent;color:transparent}.fav.ok img{opacity:1}
.tabs{display:flex;gap:6px;margin:12px 0 0}
.tab{padding:7px 16px;border-radius:999px;font-size:14px;font-weight:500;color:var(--mute)}
.tab.on{background:var(--ink);color:var(--bg)}
.grid{columns:2;column-gap:10px;margin-top:8px}
@media(min-width:560px){.grid{columns:3}}
.im{display:block;break-inside:avoid;margin:0 0 12px}
.im>img{display:block;width:100%;height:auto;min-height:60px;max-height:320px;object-fit:cover;border-radius:14px;background:var(--stone)}
.cap{display:flex;align-items:center;gap:6px;margin-top:6px;min-width:0}
.cap .fav{width:16px;height:16px;border-radius:5px;font-size:9px}
.ct{font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.src{display:block;font-size:11.5px;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
h3{margin:5px 0 3px;font-size:17px;line-height:1.3;font-weight:500;color:var(--cobalt);letter-spacing:-.005em}
h3 b,p b{font-weight:600}
.rl p{margin:0;font-size:14px;line-height:1.45;color:var(--ink);opacity:.82;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.related h4{margin:18px 2px 8px;font-size:13px;color:var(--mute);font-weight:500;text-transform:uppercase;letter-spacing:.06em}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:8px 14px;border-radius:999px;background:var(--card);box-shadow:0 0 0 1px rgb(23 20 15/.1);font-size:14px}
.pager{display:flex;justify-content:space-between;align-items:center;margin:20px 0 8px}
.btn{height:40px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;background:var(--card);box-shadow:0 0 0 1px rgb(23 20 15/.1);font-weight:500;font-size:14.5px}
.pn{font-size:13px;color:var(--mute)}
.empty{text-align:center;padding:48px 8px;color:var(--mute)}
.empty h2{color:var(--ink);font-weight:600;font-size:20px;margin:0 0 6px}
.hero{text-align:center;padding:64px 8px 24px}
.logo span{display:inline-grid;place-items:center;width:64px;height:64px;border-radius:20px;background:var(--cobalt);color:#fff;font-size:34px;font-weight:600}
.hero h1{margin:14px 0 4px;font-size:28px;letter-spacing:-.02em;font-weight:600}
.hero p{margin:0;color:var(--mute)}
footer{margin-top:28px;text-align:center;font-size:12px;color:var(--mute)}
</style>
</head>
<body>
<main>
<form id="f" method="get" action="/search" role="search">
  <span class="m" aria-hidden="true">M</span>
  <input name="q" type="search" value="${esc(query)}" placeholder="Search the web" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search">
  ${images ? '<input type="hidden" name="t" value="images">' : ""}
  <button type="submit">Search</button>
</form>
${home}
${tabs}
${query ? `<div class="meta"><span>${shown ? `${shown} ${images ? "images" : "results"}` : ""}${engines.length ? ` · ${engines.join(", ")}` : ""}</span><span>${((images ? images.took : data.took) / 1000).toFixed(2)}s</span></div>` : ""}
${images ? grid : `${instantHtml}
${cardHtml}
${list}
${relatedHtml}`}
${pager}
<footer>Mass Search · open sources, no ads, no tracking</footer>
</main>
<script>${bridge}</script>
</body>
</html>`;
}

/** Run the search (web or images) and render the page. Shared by /search and mass://search. */
export async function searchPageFor(params: URLSearchParams, request: Request, options: { dark: boolean; embedded: boolean }): Promise<string> {
  const { massSearch, massImages } = await import("@/lib/browser/masssearch.server");
  const query = (params.get("q") || "").trim();
  const page = Number(params.get("p") || "1") || 1;
  const origin = new URL(request.url).origin;
  if (params.get("t") === "images" && query) {
    const images = await massImages(query, page);
    const shell: SearchResult = { query: images.query, page: images.page, results: [], card: null, instant: null, related: [], engines: [], took: images.took };
    return renderSearchPage(shell, { ...options, origin, images });
  }
  return renderSearchPage(await massSearch(query, request, page), { ...options, origin });
}
