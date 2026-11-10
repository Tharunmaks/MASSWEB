/**
 * The script Mass Web injects at the top of every proxied page. It runs before the page's own
 * scripts inside the sandboxed (opaque-origin) frame and is the page's only line to the shell.
 *
 * Page -> shell messages (all carry source: "massweb"):
 *   hello, title, meta, open, submit, scroll, pull, pullend, linkmenu, focus,
 *   findresult, zapped, zapdone, translate-texts, translate-done
 * Shell -> page messages:
 *   config {dark, zoom, css, zapped}, find {q, step}, findclear, zap {on},
 *   translate-collect, translate-apply {start, texts}, translate-revert, scrolltop
 */
/** Ad, analytics and tracking networks whose requests are refused when page scripts add them later. */
export const TRACKER_HOSTS = [
  "doubleclick.net", "googlesyndication.com", "googleadservices.com", "google-analytics.com", "googletagmanager.com",
  "googletagservices.com", "adservice.google.com", "pagead2.googlesyndication.com", "imasdk.googleapis.com", "fundingchoicesmessages.google.com",
  "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "rubiconproject.com", "pubmatic.com", "openx.net", "criteo.com", "criteo.net",
  "casalemedia.com", "indexww.com", "taboola.com", "outbrain.com", "outbrainimg.com", "revcontent.com", "mgid.com", "media.net",
  "yieldmo.com", "sharethrough.com", "teads.tv", "smartadserver.com", "adform.net", "33across.com", "triplelift.com", "3lift.com",
  "bidswitch.net", "contextweb.com", "gumgum.com", "sovrn.com", "lijit.com", "spotxchange.com", "springserve.com", "districtm.io",
  "adsafeprotected.com", "moatads.com", "doubleverify.com", "scorecardresearch.com", "quantserve.com", "quantcount.com",
  "chartbeat.com", "chartbeat.net", "hotjar.com", "hotjar.io", "mouseflow.com", "fullstory.com", "clarity.ms", "crazyegg.com",
  "segment.io", "segment.com", "mixpanel.com", "amplitude.com", "heap.io", "heapanalytics.com", "newrelic.com", "nr-data.net",
  "connect.facebook.net", "facebook.com/tr", "analytics.twitter.com", "ads-twitter.com", "static.ads-twitter.com", "ads.linkedin.com",
  "snap.licdn.com", "px.ads.linkedin.com", "bat.bing.com", "tiktok.com/i18n/pixel", "analytics.tiktok.com", "ct.pinterest.com",
  "sc-static.net", "branch.io", "app.link", "adjust.com", "appsflyer.com", "kochava.com", "onesignal.com", "pushwoosh.com",
  "izooto.com", "vdo.ai", "adpushup.com", "ezoic.net", "ezojs.com", "mediavine.com", "adthrive.com", "raptive.com", "freestar.io",
  "pubfig.js", "prebid", "adrecover.com", "zedo.com", "propellerads.com", "popads.net", "popcash.net", "adsterra.com",
  "exoclick.com", "juicyads.com", "trafficjunky.net", "inmobi.com", "colombiaonline.com", "colombia.indiatimes.com", "growthrx.in",
  "permutive.com", "permutive.app", "id5-sync.com", "liveramp.com", "rlcdn.com", "bluekai.com", "demdex.net", "omtrdc.net",
  "everesttech.net", "krxd.net", "agkn.com", "tapad.com", "adsymptotic.com", "zemanta.com", "nativo.com", "primis.tech",
  "cookielaw.org", "onetrust.com", "trustarc.com", "quantcast.com", "consensu.org", "sourcepoint.com", "privacy-mgmt.com",
];

export function injectedScript(pageUrl: string, options: { dark?: boolean; block?: boolean; lite?: boolean } = {}): string {
  const page = JSON.stringify(pageUrl).replace(/</g, "\\u003c");
  const body = String.raw`(function(){
var PAGE = __PAGE__;
var START_DARK = __DARK__;
var me = document.currentScript;
function post(msg){ msg.source = "massweb"; try { parent.postMessage(msg, "*"); } catch (e) {} }
function resolve(href){
  try {
    var u = new URL(String(href), document.baseURI);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch (e) { return null; }
}
function noHash(href){ var i = href.indexOf("#"); return i < 0 ? href : href.slice(0, i); }
function isInPage(abs){ return abs.indexOf("#") >= 0 && noHash(abs) === noHash(PAGE); }
function scrollToHash(abs){
  var id = "";
  try { id = decodeURIComponent(abs.slice(abs.indexOf("#") + 1)); } catch (e) { id = abs.slice(abs.indexOf("#") + 1); }
  var el = id ? (document.getElementById(id) || document.getElementsByName(id)[0]) : null;
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth" });
  else if (!id || id.toLowerCase() === "top") window.scrollTo({ top: 0, behavior: "smooth" });
}
function go(abs){ post({ type: "open", href: abs }); }

/* ---------- runtime ad/tracker blocking for requests page scripts add after load ---------- */
var BLOCK = __BLOCK__;
var blockedHosts = {};
var blockTick = null;
function isTracker(raw){
  if (!BLOCK || !raw) return false;
  var u;
  try { u = new URL(String(raw), document.baseURI); } catch (e) { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  var host = u.hostname.toLowerCase(), full = host + u.pathname.toLowerCase();
  for (var i = 0; i < BLOCK.length; i++) {
    var rule = BLOCK[i];
    if (rule.indexOf("/") > 0) { if (full.indexOf(rule) === 0 || full.indexOf("." + rule) >= 0) return note(host); }
    else if (rule.indexOf(".") < 0) { if (u.pathname.toLowerCase().indexOf(rule) >= 0 && /\.js$/.test(u.pathname)) return note(host); }
    else if (host === rule || host.slice(-rule.length - 1) === "." + rule) return note(host);
  }
  return false;
}
function note(host){
  host = host.replace(/^www\./, "");
  blockedHosts[host] = (blockedHosts[host] || 0) + 1;
  if (!blockTick) blockTick = setTimeout(function(){
    blockTick = null;
    var list = Object.keys(blockedHosts).map(function(h){ return h + ":" + blockedHosts[h]; });
    blockedHosts = {};
    post({ type: "blocked", trackers: list.join(",") });
  }, 400);
  return true;
}
if (BLOCK) {
  [[window.HTMLScriptElement, "src"], [window.HTMLIFrameElement, "src"], [window.HTMLImageElement, "src"], [window.HTMLLinkElement, "href"], [window.HTMLSourceElement, "src"]].forEach(function(pair){
    if (!pair[0]) return;
    var proto = pair[0].prototype, name = pair[1];
    var desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, name, {
      configurable: true, enumerable: desc.enumerable,
      get: function(){ return desc.get.call(this); },
      set: function(v){
        if (isTracker(v)) {
          if (this.tagName === "SCRIPT") { var el = this; setTimeout(function(){ try { el.dispatchEvent(new Event("error")); } catch (e) {} }, 0); return; }
          return;
        }
        return desc.set.call(this, v);
      }
    });
  });
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value){
    var n = String(name).toLowerCase();
    if ((n === "src" || n === "href") && /^(SCRIPT|IFRAME|IMG|LINK|SOURCE)$/.test(this.tagName) && isTracker(value)) return;
    return setAttr.call(this, name, value);
  };
  var nativeFetch = window.fetch;
  if (nativeFetch) window.fetch = function(input, init){
    var target = typeof input === "string" ? input : (input && input.url);
    if (isTracker(target)) return Promise.reject(new TypeError("Blocked by Mass Web shields"));
    return nativeFetch.apply(this, arguments);
  };
  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    if (isTracker(url)) { this.__mwBlocked = true; arguments[1] = "data:,"; }
    return xhrOpen.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data){ if (isTracker(url)) return true; return beacon(url, data); };
  }
}

/* ---------- sandbox shims: let normal sites boot inside an opaque-origin frame ---------- */
(function(){
  var Native = window.URL;
  if (!Native) return;
  function fixBase(b){
    if (b === undefined || b === null) return b;
    var s = String(b);
    if (s === "null" || s.indexOf("null/") === 0 || s.indexOf("about:srcdoc") === 0 || s === "about:blank") return PAGE;
    return b;
  }
  function URLShim(url, base){ return arguments.length > 1 ? new Native(url, fixBase(base)) : new Native(url); }
  URLShim.prototype = Native.prototype;
  Object.setPrototypeOf(URLShim, Native);
  if (Native.canParse) URLShim.canParse = function(url, base){ return arguments.length > 1 ? Native.canParse(url, fixBase(base)) : Native.canParse(url); };
  if (Native.parse) URLShim.parse = function(url, base){ return arguments.length > 1 ? Native.parse(url, fixBase(base)) : Native.parse(url); };
  try { Object.defineProperty(window, "URL", { value: URLShim, configurable: true, writable: true }); } catch (e) {}
})();
function memStore(){
  var d = Object.create(null);
  return {
    getItem: function(k){ k = String(k); return k in d ? d[k] : null; },
    setItem: function(k, v){ d[String(k)] = String(v); },
    removeItem: function(k){ delete d[String(k)]; },
    clear: function(){ d = Object.create(null); },
    key: function(i){ var ks = Object.keys(d); return i < ks.length ? ks[i] : null; },
    get length(){ return Object.keys(d).length; }
  };
}
["localStorage", "sessionStorage"].forEach(function(name){
  try { window[name].getItem("__massweb"); }
  catch (e) { try { Object.defineProperty(window, name, { value: memStore(), configurable: true }); } catch (e2) {} }
});
try { void document.cookie; } catch (e) {
  var jar = {};
  try {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: function(){ return Object.keys(jar).map(function(k){ return k + "=" + jar[k]; }).join("; "); },
      set: function(v){
        var part = String(v).split(";")[0];
        var i = part.indexOf("=");
        if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim();
      }
    });
  } catch (e2) {}
}
try { void navigator.serviceWorker; } catch (e) {
  try {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      controller: null,
      ready: new Promise(function(){}),
      register: function(){ return Promise.reject(new Error("Service workers are off in Mass Web.")); },
      getRegistration: function(){ return Promise.resolve(undefined); },
      getRegistrations: function(){ return Promise.resolve([]); },
      addEventListener: function(){}, removeEventListener: function(){}
    } });
  } catch (e2) {}
}
["pushState", "replaceState"].forEach(function(name){
  var orig = history[name];
  if (!orig) return;
  history[name] = function(state, title, url){
    try { return orig.call(history, state, title, url); }
    catch (e) { try { return orig.call(history, state, title); } catch (e2) {} }
  };
});
window.open = function(url){
  var abs = url ? resolve(url) : null;
  if (abs) go(abs);
  return null;
};

/* ---------- navigation: every way out goes back to the shell ---------- */
function submitForm(form, submitter){
  var action = (submitter && submitter.getAttribute && submitter.getAttribute("formaction")) || form.getAttribute("action") || PAGE;
  var abs = resolve(action) || PAGE;
  var method = ((submitter && submitter.getAttribute && submitter.getAttribute("formmethod")) || form.getAttribute("method") || "get").toLowerCase();
  var data;
  try { data = submitter ? new FormData(form, submitter) : new FormData(form); } catch (e) { data = new FormData(form); }
  var params = new URLSearchParams();
  data.forEach(function(value, key){ if (typeof value === "string") params.append(key, value); });
  if (method === "post") { post({ type: "submit", href: abs, body: params.toString() }); return; }
  var u = new URL(abs);
  u.search = params.toString();
  u.hash = "";
  go(u.href);
}
try { HTMLFormElement.prototype.submit = function(){ submitForm(this, null); }; } catch (e) {}

var zapping = false;
window.addEventListener("click", function(event){
  if (zapping) return;
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  var node = event.target;
  var link = node && node.closest ? node.closest("a[href], area[href]") : null;
  if (!link || link.hasAttribute("download")) return;
  var raw = link.getAttribute("href") || "";
  if (/^\s*javascript:/i.test(raw)) return;
  var abs = resolve(raw);
  if (!abs) return;
  event.preventDefault();
  if (isInPage(abs)) { scrollToHash(abs); return; }
  go(abs);
});
window.addEventListener("submit", function(event){
  if (event.defaultPrevented) return;
  var form = event.target;
  if (!form || form.tagName !== "FORM") return;
  event.preventDefault();
  submitForm(form, event.submitter || null);
});
if (window.navigation && window.navigation.addEventListener) {
  window.navigation.addEventListener("navigate", function(event){
    if (!event.cancelable || event.hashChange || event.downloadRequest) return;
    var dest = event.destination && event.destination.url;
    if (!dest || !/^https?:/i.test(dest)) return;
    event.preventDefault();
    if (isInPage(dest)) { scrollToHash(dest); return; }
    go(dest);
  });
}

/* ---------- long-press menu for links and images ---------- */
window.addEventListener("contextmenu", function(event){
  if (zapping) return;
  var node = event.target;
  if (!node || !node.closest) return;
  var link = node.closest("a[href]");
  var img = node.closest("img");
  var href = link ? resolve(link.getAttribute("href") || "") : null;
  var src = img ? resolve(img.currentSrc || img.src || "") : null;
  if (!href && !src) return;
  event.preventDefault();
  post({ type: "linkmenu", href: href, text: link ? (link.innerText || link.textContent || "").trim().slice(0, 140) : "", image: src });
}, true);

/* ---------- scroll + pull-to-refresh reporting ---------- */
var lastY = 0, ticking = false;
function scrollY(){ return window.scrollY || document.documentElement.scrollTop || (document.body && document.body.scrollTop) || 0; }
window.addEventListener("scroll", function(){
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(function(){
    ticking = false;
    var y = scrollY();
    post({ type: "scroll", y: y, dy: y - lastY });
    lastY = y;
  });
}, { passive: true, capture: true });
var pullStart = null, pullD = 0, pullTick = false;
window.addEventListener("touchstart", function(e){
  pullStart = (scrollY() <= 0 && e.touches.length === 1) ? e.touches[0].clientY : null;
  pullD = 0;
}, { passive: true });
window.addEventListener("touchmove", function(e){
  if (pullStart === null) return;
  if (scrollY() > 0) { pullStart = null; post({ type: "pullend", d: 0 }); return; }
  pullD = e.touches[0].clientY - pullStart;
  if (pullTick) return;
  pullTick = true;
  requestAnimationFrame(function(){ pullTick = false; post({ type: "pull", d: Math.max(0, pullD) }); });
}, { passive: true });
window.addEventListener("touchend", function(){
  if (pullStart !== null) post({ type: "pullend", d: Math.max(0, pullD) });
  pullStart = null; pullD = 0;
}, { passive: true });
window.addEventListener("pointerdown", function(){ post({ type: "focus" }); }, { passive: true, capture: true });

/* ---------- per-site look: dark pages, zoom, Boost CSS, zapped elements ---------- */
var DARK_CSS = "html{filter:invert(0.92) hue-rotate(180deg)!important;background:#fff!important}" +
  "img,video,picture,canvas,iframe,embed,object,svg image,[style*='background-image']{filter:invert(1) hue-rotate(180deg)!important}";
function styleEl(id){
  var el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    (document.head || document.documentElement).appendChild(el);
  }
  return el;
}
function alreadyDark(){
  try {
    var nodes = [document.body, document.documentElement];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i]) continue;
      var c = getComputedStyle(nodes[i]).backgroundColor.match(/[\d.]+/g);
      if (!c || (c.length > 3 && Number(c[3]) === 0)) continue;
      var lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
      return lum < 0.35;
    }
  } catch (e) {}
  return false;
}
var wantDark = START_DARK;
function applyDark(){
  var el = styleEl("mw-dark");
  el.textContent = "";
  if (!wantDark) return;
  if (document.body && alreadyDark()) return;
  el.textContent = DARK_CSS;
}
if (START_DARK) styleEl("mw-dark").textContent = DARK_CSS;
document.addEventListener("DOMContentLoaded", function(){ if (wantDark) applyDark(); });
function applyConfig(cfg){
  if (typeof cfg.dark === "boolean") {
    wantDark = cfg.dark;
    if (document.body) applyDark();
    else styleEl("mw-dark").textContent = wantDark ? DARK_CSS : "";
  }
  if (typeof cfg.zoom === "number") document.documentElement.style.zoom = cfg.zoom === 1 ? "" : String(cfg.zoom);
  var css = cfg.css || "";
  if (cfg.zapped && cfg.zapped.length) css += "\n" + cfg.zapped.join(",") + "{display:none!important}";
  styleEl("mw-boost").textContent = css;
  if (cfg.highlights) { wantHighlights = cfg.highlights; if (document.body) paintHighlights(); }
}

/* ---------- saved highlights: find each saved passage (even across elements) and mark it ---------- */
var wantHighlights = [];
function textIndex(){
  // Only visible text: a user's selection never includes hidden text, so neither should the search.
  var seen = new Map();
  var all = [];
  if (document.body) {
    // Keep whitespace-only nodes too: they are the spaces between links and words.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n){
        var p = n.parentElement;
        return p && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA)$/.test(p.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) all.push(walker.currentNode);
  }
  var nodes = all.filter(function(n){
    var el = n.parentElement;
    if (!el) return false;
    if (seen.has(el)) return seen.get(el);
    var v = el.checkVisibility ? el.checkVisibility() : !!(el.offsetParent || el.getClientRects().length);
    seen.set(el, v);
    return v;
  });
  var starts = [], text = "";
  for (var i = 0; i < nodes.length; i++) { starts.push(text.length); text += nodes[i].nodeValue; }
  return { nodes: nodes, starts: starts, text: text };
}
function rangeFor(index, from, to){
  function locate(pos){
    var lo = 0, hi = index.starts.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (index.starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return { node: index.nodes[lo], offset: pos - index.starts[lo] };
  }
  var a = locate(from), b = locate(to);
  var r = document.createRange();
  try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch (e) { return null; }
  return r;
}
function paintHighlights(){
  if (!hasHighlights) return;
  if (!wantHighlights.length) { CSS.highlights.delete("mw-hl"); return; }
  var index = textIndex();
  var ranges = [];
  var squash = function(t){ return t.replace(/\s+/g, " ").trim(); };
  for (var i = 0; i < wantHighlights.length; i++) {
    var needle = squash(String(wantHighlights[i] || ""));
    if (needle.length < 2) continue;
    var at = index.text.indexOf(needle);
    if (at < 0) {
      // Whitespace differs between the page and the saved text: search a squashed copy and map back.
      var map = [], flat = "", prevSpace = false;
      for (var k = 0; k < index.text.length; k++) {
        var ch = index.text[k], space = /\s/.test(ch);
        if (space && prevSpace) continue;
        map.push(k); flat += space ? " " : ch; prevSpace = space;
      }
      var j = flat.indexOf(needle);
      if (j < 0) {
        // Last resort: anchor on the passage's first and last words.
        var head = needle.slice(0, 32), tail = needle.slice(-32);
        var hs = flat.indexOf(head);
        var te = hs < 0 ? -1 : flat.indexOf(tail, hs);
        if (hs < 0 || te < 0 || te - hs > needle.length * 1.6) continue;
        var r2 = rangeFor(index, map[hs], map[te + tail.length - 1] + 1);
        if (r2) ranges.push(r2);
        continue;
      }
      at = map[j];
      var end = map[j + needle.length - 1] + 1;
      var r1 = rangeFor(index, at, end);
      if (r1) ranges.push(r1);
      continue;
    }
    var r = rangeFor(index, at, at + needle.length);
    if (r) ranges.push(r);
  }
  if (ranges.length) CSS.highlights.set("mw-hl", new Highlight(...ranges));
  else CSS.highlights.delete("mw-hl");
}
document.addEventListener("DOMContentLoaded", function(){ if (wantHighlights.length) paintHighlights(); });
addEventListener("load", function(){ if (wantHighlights.length) setTimeout(paintHighlights, 300); });

/* ---------- text selection -> shell actions (explain, translate, highlight) ---------- */
var selTimer = null, lastSel = "";
document.addEventListener("selectionchange", function(){
  clearTimeout(selTimer);
  selTimer = setTimeout(function(){
    var sel = window.getSelection();
    var t = sel ? String(sel).replace(/\s+/g, " ").trim() : "";
    if (t.length > 4000) t = t.slice(0, 4000);
    if (t === lastSel) return;
    lastSel = t;
    post({ type: "selection", text: t.length >= 2 ? t : "" });
  }, 350);
});

/* ---------- data saver: tap a placeholder to load it ---------- */
var LITE = __LITE__;
if (LITE) {
  styleEl("mw-lite").textContent = "img[data-mw-lite]{background:repeating-linear-gradient(135deg,#e8e0d2 0 8px,#efe8dc 8px 16px)!important;min-width:48px;min-height:48px;border-radius:8px;cursor:pointer}" +
    "iframe[data-mw-lite],video[data-mw-lite]{background:#e8e0d2;min-height:60px}";
  document.addEventListener("click", function(e){
    var el = e.target && e.target.closest ? e.target.closest("img[data-mw-lite], video[data-mw-lite], iframe[data-mw-lite]") : null;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    ["src", "srcset", "poster"].forEach(function(n){ var v = el.getAttribute("data-mw-" + n); if (v) el.setAttribute(n, v); });
    if (el.parentElement && el.parentElement.tagName === "PICTURE") {
      Array.prototype.forEach.call(el.parentElement.querySelectorAll("source[data-mw-srcset]"), function(s){ s.setAttribute("srcset", s.getAttribute("data-mw-srcset")); });
    }
    el.removeAttribute("data-mw-lite");
  }, true);
}

/* ---------- find in page (CSS Custom Highlight API, with a scroll-only fallback) ---------- */
var findRanges = [], findIndex = -1;
function textNodes(root){
  var out = [];
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function(n){
      var p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  while (walker.nextNode()) out.push(walker.currentNode);
  return out;
}
var hasHighlights = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";
if (hasHighlights) styleEl("mw-find-style").textContent = "::highlight(mw-find){background:#ffe48a;color:#000}::highlight(mw-find-current){background:#ff9a3c;color:#000}::highlight(mw-hl){background:rgba(255,214,10,.45);color:inherit}";
function clearFind(){
  findRanges = []; findIndex = -1;
  if (hasHighlights) { CSS.highlights.delete("mw-find"); CSS.highlights.delete("mw-find-current"); }
}
function runFind(q, step){
  if (!q) { clearFind(); post({ type: "findresult", count: 0, index: -1 }); return; }
  if (!findRanges.q || findRanges.q !== q) {
    clearFind();
    var needle = q.toLowerCase();
    var nodes = document.body ? textNodes(document.body) : [];
    for (var i = 0; i < nodes.length && findRanges.length < 1000; i++) {
      var hay = nodes[i].nodeValue.toLowerCase();
      var at = hay.indexOf(needle);
      while (at >= 0 && findRanges.length < 1000) {
        var r = document.createRange();
        r.setStart(nodes[i], at); r.setEnd(nodes[i], at + needle.length);
        findRanges.push(r);
        at = hay.indexOf(needle, at + needle.length);
      }
    }
    findRanges.q = q;
    findIndex = findRanges.length ? 0 : -1;
  } else if (findRanges.length) {
    findIndex = (findIndex + (step || 1) + findRanges.length) % findRanges.length;
  }
  if (hasHighlights) {
    CSS.highlights.set("mw-find", new Highlight(...findRanges));
    if (findIndex >= 0) CSS.highlights.set("mw-find-current", new Highlight(findRanges[findIndex]));
  }
  if (findIndex >= 0) {
    var rect = findRanges[findIndex].getBoundingClientRect();
    window.scrollBy({ top: rect.top - window.innerHeight / 3, behavior: "smooth" });
  }
  post({ type: "findresult", count: findRanges.length, index: findIndex });
}

/* ---------- zap: tap elements to hide them (saved as a per-site Boost) ---------- */
var zapBox = null, zapTarget = null;
function selectorFor(el){
  if (el.id && /^[a-z][\w-]*$/i.test(el.id) && !/\d{3,}/.test(el.id) && document.querySelectorAll("#" + el.id).length === 1) return "#" + el.id;
  var parts = [];
  var node = el;
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
    var part = node.tagName.toLowerCase();
    var cls = Array.prototype.filter.call(node.classList, function(c){ return /^[a-z_-][\w-]*$/i.test(c) && !/\d{3,}/.test(c); }).slice(0, 2);
    if (cls.length) part += "." + cls.join(".");
    var parent = node.parentElement;
    if (parent) {
      var same = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
      if (same.length > 1 && !cls.length) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
    }
    parts.unshift(part);
    var sel = parts.join(" > ");
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
    node = parent;
  }
  return parts.join(" > ");
}
function zapOutline(el){
  if (!zapBox) {
    zapBox = document.createElement("div");
    zapBox.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #e5484d;background:rgba(229,72,77,.18);border-radius:4px;transition:all .08s ease-out";
    document.documentElement.appendChild(zapBox);
  }
  var r = el.getBoundingClientRect();
  zapBox.style.left = r.left + "px"; zapBox.style.top = r.top + "px";
  zapBox.style.width = r.width + "px"; zapBox.style.height = r.height + "px";
  zapBox.style.display = "block";
}
function zapPick(e){
  if (!zapping) return;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === document.body || el === document.documentElement) return;
  zapTarget = el;
  zapOutline(el);
}
document.addEventListener("pointermove", zapPick, true);
document.addEventListener("pointerdown", zapPick, true);
document.addEventListener("click", function(e){
  if (!zapping) return;
  e.preventDefault(); e.stopPropagation();
  var el = zapTarget || document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === document.body || el === document.documentElement) return;
  var sel = selectorFor(el);
  el.style.setProperty("display", "none", "important");
  if (zapBox) zapBox.style.display = "none";
  zapTarget = null;
  post({ type: "zapped", selector: sel });
}, true);

/* ---------- translation: hand text to the shell, put translations back ---------- */
var trNodes = [], trOriginal = [];
function collectForTranslation(){
  trNodes = []; trOriginal = [];
  var nodes = document.body ? textNodes(document.body) : [];
  var texts = [];
  for (var i = 0; i < nodes.length && texts.length < 2500; i++) {
    var p = nodes[i].parentElement;
    if (p && p.closest && p.closest("code, pre, kbd, samp, [translate='no'], .notranslate")) continue;
    var t = nodes[i].nodeValue;
    if (!/[A-Za-zÀ-￿]{2,}/.test(t)) continue;
    trNodes.push(nodes[i]);
    trOriginal.push(t);
    texts.push(t.trim());
  }
  post({ type: "translate-texts", texts: texts, lang: document.documentElement.lang || "" });
}
function applyTranslations(start, texts){
  for (var i = 0; i < texts.length; i++) {
    var n = trNodes[start + i];
    if (!n || typeof texts[i] !== "string" || !texts[i]) continue;
    var orig = trOriginal[start + i];
    var lead = orig.match(/^\s*/)[0], trail = orig.match(/\s*$/)[0];
    n.nodeValue = lead + texts[i] + trail;
  }
}
function revertTranslations(){
  for (var i = 0; i < trNodes.length; i++) if (trNodes[i]) trNodes[i].nodeValue = trOriginal[i];
}

/* ---------- messages from the shell ---------- */
window.addEventListener("message", function(event){
  if (event.source !== parent) return;
  var d = event.data;
  if (!d || d.source !== "massweb-shell") return;
  if (d.type === "config") applyConfig(d);
  else if (d.type === "find") runFind(String(d.q || ""), d.step || 0);
  else if (d.type === "findclear") clearFind();
  else if (d.type === "zap") { zapping = !!d.on; if (!zapping && zapBox) zapBox.style.display = "none"; }
  else if (d.type === "unzap") { try { document.querySelectorAll(String(d.selector || "")).forEach(function(el){ el.style.removeProperty("display"); }); } catch (e) {} }
  else if (d.type === "translate-collect") collectForTranslation();
  else if (d.type === "translate-apply") applyTranslations(d.start || 0, d.texts || []);
  else if (d.type === "translate-revert") revertTranslations();
  else if (d.type === "scrolltop") window.scrollTo({ top: 0, behavior: "smooth" });
  else if (d.type === "text-collect") {
    var body = document.body ? (document.body.innerText || "") : "";
    post({ type: "page-text", id: d.id, title: document.title || "", text: body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, 30000) });
  }
  else if (d.type === "clearselection") { try { window.getSelection().removeAllRanges(); lastSel = ""; } catch (e) {} }
});

/* ---------- tell the shell about this page ---------- */
function meta(name){
  var el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
  return el ? (el.getAttribute("content") || "") : "";
}
function sendTitle(){ post({ type: "title", title: document.title || "" }); }
function sendMeta(){
  var icon = document.querySelector('link[rel~="icon"][sizes="192x192"], link[rel="apple-touch-icon"], link[rel~="icon"]');
  post({
    type: "meta",
    title: document.title || "",
    themeColor: meta("theme-color"),
    image: resolve(meta("og:image") || meta("twitter:image") || "") || "",
    icon: icon ? (resolve(icon.getAttribute("href") || "") || "") : "",
    description: (meta("og:description") || meta("description") || "").slice(0, 300),
    feed: (function(){ var f = document.querySelector('link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]'); return f ? (resolve(f.getAttribute("href") || "") || "") : ""; })(),
    lang: document.documentElement.lang || ""
  });
}
post({ type: "hello" });
sendTitle();
addEventListener("DOMContentLoaded", function(){ sendTitle(); sendMeta(); });
addEventListener("load", sendTitle);
if (me && me.parentNode) me.parentNode.removeChild(me);
})();`;
  const block = options.block ? JSON.stringify(TRACKER_HOSTS) : "null";
  return `<script>${body.replace("__PAGE__", page).replace("__DARK__", options.dark ? "true" : "false").replace("__BLOCK__", block).replace("__LITE__", options.lite ? "true" : "false")}</script>`;
}
