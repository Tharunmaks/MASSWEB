import type { SearchResult, Source } from "@/lib/browser/masssearch.server";

/** The Mass Search results page, as HTML. Works standalone (/search) and inside Mass Web (mass://search). */

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

function searchHref(query: string, page: number, embedded: boolean): string {
  const qs = `q=${encodeURIComponent(query)}${page > 1 ? `&p=${page}` : ""}`;
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

function resultItem(r: Source, query: string): string {
  const letter = r.host.replace(/^www\./, "").slice(0, 1).toUpperCase();
  return `<li class="r">
  <a class="rl" href="${esc(r.url)}">
    <div class="rh"><span class="fav" aria-hidden="true">${esc(letter)}</span><span class="crumb">${esc(crumb(r.url))}</span></div>
    <h3>${highlight(r.title, query)}</h3>
    ${r.snippet ? `<p>${highlight(r.snippet, query)}</p>` : ""}
  </a>
</li>`;
}

export function renderSearchPage(data: SearchResult, options: { dark: boolean; embedded: boolean }): string {
  const { query, page, results, card, instant, related, engines } = data;
  const { dark, embedded } = options;
  const title = query ? `${query} - Mass Search` : "Mass Search";
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
    ? `<ol class="results">${results.map((r) => resultItem(r, query)).join("")}</ol>`
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

  const pager = query
    ? `<nav class="pager">${page > 1 ? `<a class="btn" href="${esc(searchHref(query, page - 1, embedded))}">‹ Previous</a>` : "<span></span>"}<span class="pn">Page ${page}</span>${
        results.length >= 6 && page < 5 ? `<a class="btn" href="${esc(searchHref(query, page + 1, embedded))}">Next ›</a>` : "<span></span>"
      }</nav>`
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
  var f=document.getElementById("f");if(f)f.addEventListener("submit",function(e){e.preventDefault();var q=f.q.value.trim();if(q)post({type:"open",href:"mass://search?q="+encodeURIComponent(q)})});
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
.fav{width:20px;height:20px;border-radius:6px;background:var(--stone);display:grid;place-items:center;font-size:11px;font-weight:600;color:var(--ink);flex:none}
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
  <button type="submit">Search</button>
</form>
${home}
${query ? `<div class="meta"><span>${results.length ? `${results.length} results` : ""}${engines.length ? ` · ${engines.join(", ")}` : ""}</span><span>${(data.took / 1000).toFixed(2)}s</span></div>` : ""}
${instantHtml}
${cardHtml}
${list}
${relatedHtml}
${pager}
<footer>Mass Search · open sources, no ads, no tracking</footer>
</main>
<script>${bridge}</script>
</body>
</html>`;
}
