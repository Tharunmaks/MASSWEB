"""MnxSpider: the live crawler.

Each run it reads news and blog feeds for fresh pages, then crawls outward along links
to discover new pages and new sites, the way search-engine spiders do. It is polite:
it obeys robots.txt, waits between requests to the same site, names itself in its
User-Agent, and stays inside a time budget.
"""

from __future__ import annotations

import asyncio
import gzip
import heapq
import json
import os
import re
import time
from email.utils import parsedate_to_datetime
from urllib import robotparser
from urllib.parse import urljoin
from xml.etree import ElementTree

import httpx
import trafilatura

from .common import USER_AGENT, Shard, english_ratio, host_of, is_spammy, normalize_url, now_iso, url_key
from .ranks import Ranks

MAX_BYTES = 3_000_000
HTML_TYPES = ("text/html", "application/xhtml+xml")
FEED_TYPES = ("xml", "rss", "atom")


def iso(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    try:
        return parsedate_to_datetime(value).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError, IndexError):
        pass
    match = re.match(r"(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?", value)
    if not match:
        return ""
    clock = match.group(2) or "00:00:00"
    if len(clock) == 5:
        clock += ":00"
    return f"{match.group(1)}T{clock}Z"


def parse_feed(xml: bytes, base: str) -> list[tuple[str, str]]:
    """(url, published) pairs from an RSS or Atom feed."""
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError:
        return []
    out: list[tuple[str, str]] = []
    for item in root.iter():
        tag = item.tag.rsplit("}", 1)[-1]
        if tag not in ("item", "entry"):
            continue
        link = ""
        date = ""
        for child in item:
            name = child.tag.rsplit("}", 1)[-1]
            if name == "link":
                href = child.get("href")
                if href and child.get("rel", "alternate") == "alternate":
                    link = link or href
                elif (child.text or "").strip():
                    link = link or child.text.strip()
            elif name == "guid" and not link and (child.text or "").startswith("http") and child.get("isPermaLink", "true") != "false":
                link = child.text.strip()
            elif name in ("pubDate", "published", "updated", "date") and not date:
                date = iso(child.text or "")
        url = normalize_url(urljoin(base, link)) if link else None
        if url:
            out.append((url, date))
    return out


LINK = re.compile(r"""<a\s[^>]*?href\s*=\s*["']([^"'#]+)""", re.I)


class Spider:
    def __init__(self, ranks: Ranks, shard: Shard, seen: set[str], budget_s: float, max_pages: int, concurrency: int = 24):
        self.ranks = ranks
        self.shard = shard
        self.seen = seen
        self.deadline = time.monotonic() + budget_s
        self.max_pages = max_pages
        self.concurrency = concurrency
        self.queue: list[tuple[float, int, str, str, int]] = []  # (priority, n, url, published, depth)
        self.counter = 0
        self.queued: set[str] = set()
        self.robots: dict[str, robotparser.RobotFileParser | None] = {}
        self.robots_lock: dict[str, asyncio.Lock] = {}
        self.next_ok: dict[str, float] = {}
        self.delay: dict[str, float] = {}
        self.per_host: dict[str, int] = {}
        self.discovered: list[tuple[float, str]] = []
        self.stats = {"fetched": 0, "indexed": 0, "robots_blocked": 0, "errors": 0, "skipped": 0}

    # ---------- queue ----------
    def push(self, url: str, published: str = "", depth: int = 0, boost: float = 0.0) -> None:
        key = url_key(url)
        if key in self.seen or key in self.queued:
            return
        host = host_of(url)
        if not self.ranks.allowed(host):
            return
        self.queued.add(key)
        self.counter += 1
        fresh = 1.0 if published else 0.0
        priority = -(self.ranks.quality(host) + fresh + boost - depth * 0.4)
        heapq.heappush(self.queue, (priority, self.counter, url, published, depth))

    # ---------- politeness ----------
    async def allowed(self, client: httpx.AsyncClient, url: str) -> bool:
        host = httpx.URL(url).host
        origin = f"{httpx.URL(url).scheme}://{host}"
        if host not in self.robots:
            lock = self.robots_lock.setdefault(host, asyncio.Lock())
            async with lock:
                if host not in self.robots:
                    parser: robotparser.RobotFileParser | None = robotparser.RobotFileParser()
                    try:
                        res = await client.get(origin + "/robots.txt", timeout=10)
                        if res.status_code in (401, 403):
                            parser = None  # the site forbids robots entirely
                        elif res.status_code >= 400:
                            parser.parse([])
                        else:
                            parser.parse(res.text.splitlines())
                    except httpx.HTTPError:
                        parser.parse([])
                    self.robots[host] = parser
                    if parser is not None:
                        delay = parser.crawl_delay(USER_AGENT) or parser.crawl_delay("*")
                        self.delay[host] = min(max(float(delay or 1.0), 1.0), 20.0)
        parser = self.robots[host]
        return parser is not None and parser.can_fetch(USER_AGENT, url)

    async def wait_turn(self, host: str) -> None:
        while True:
            now = time.monotonic()
            ready = self.next_ok.get(host, 0.0)
            if now >= ready:
                self.next_ok[host] = now + self.delay.get(host, 1.0)
                return
            await asyncio.sleep(ready - now)

    # ---------- fetching ----------
    async def fetch(self, client: httpx.AsyncClient, url: str) -> tuple[str, str, bytes] | None:
        host = host_of(url)
        await self.wait_turn(host)
        try:
            async with client.stream("GET", url, timeout=20) as res:
                if res.status_code >= 400:
                    return None
                kind = res.headers.get("content-type", "").lower()
                body = bytearray()
                async for chunk in res.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        break
                return str(res.url), kind, bytes(body)
        except (httpx.HTTPError, UnicodeError):
            self.stats["errors"] += 1
            return None

    async def read_feed(self, client: httpx.AsyncClient, feed: str) -> None:
        if not await self.allowed(client, feed):
            return
        got = await self.fetch(client, feed)
        if not got:
            return
        for url, published in parse_feed(got[2], got[0])[:60]:
            self.push(url, published, depth=0, boost=0.5)

    async def visit(self, client: httpx.AsyncClient, url: str, published: str, depth: int) -> None:
        host = host_of(url)
        if self.per_host.get(host, 0) >= 120:
            self.stats["skipped"] += 1
            return
        if not await self.allowed(client, url):
            self.stats["robots_blocked"] += 1
            return
        got = await self.fetch(client, url)
        self.seen.add(url_key(url))
        if not got:
            return
        final, kind, raw = got
        self.stats["fetched"] += 1
        self.per_host[host] = self.per_host.get(host, 0) + 1
        if not any(t in kind for t in HTML_TYPES):
            return
        html = raw.decode("utf-8", "replace")
        if re.search(r"<meta[^>]+name=[\"']robots[\"'][^>]+content=[\"'][^\"']*noindex", html[:20000], re.I):
            return
        final = normalize_url(final) or url
        self.seen.add(url_key(final))
        try:
            data = trafilatura.extract(
                html,
                url=final,
                output_format="json",
                with_metadata=True,
                include_comments=False,
                include_tables=True,
                favor_precision=True,
                date_extraction_params={"original_date": True, "extensive_search": False},
            )
        except Exception:  # noqa: BLE001 - one broken page shouldn't stop the spider
            data = None
        if data:
            doc = json.loads(data)
            title = (doc.get("title") or "").strip()
            body = (doc.get("text") or "").strip()
            # The feed's date is the most reliable; then the page's own declared publish date.
            date = published or iso(doc.get("date") or "")
            lang = "en" if english_ratio(body) >= 0.12 else ""
            if len(body) >= 300 and title and not is_spammy(final, title, body):
                if self.shard.add(url=final, title=title, body=body, published=date, crawled=now_iso(), lang=lang, source="mnxspider", quality=self.ranks.quality(host)):
                    self.stats["indexed"] += 1
        # Follow links outward: same-site links one level deep, other sites for discovery.
        if depth < 2:
            same = 0
            for href in LINK.findall(html)[:400]:
                link = normalize_url(urljoin(final, href.strip()))
                if not link:
                    continue
                link_host = host_of(link)
                if link_host == host:
                    if same < 6 and depth < 1:
                        same += 1
                        self.push(link, depth=depth + 1)
                elif self.ranks.allowed(link_host):
                    self.push(link, depth=depth + 1, boost=0.2)
                    self.discovered.append((self.ranks.quality(link_host), link))

    async def run(self, feeds: list[str], frontier: list[str]) -> None:
        limits = httpx.Limits(max_connections=self.concurrency * 2, max_keepalive_connections=self.concurrency)
        headers = {"user-agent": USER_AGENT, "accept": "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5", "accept-language": "en"}
        async with httpx.AsyncClient(headers=headers, follow_redirects=True, limits=limits, http2=False) as client:
            sem = asyncio.Semaphore(self.concurrency)

            async def guarded(coro):
                async with sem:
                    if time.monotonic() < self.deadline:
                        try:
                            await coro
                        except Exception as error:  # noqa: BLE001 - a broken feed shouldn't stop the run
                            print(f"[spider] feed failed: {error}")
                    else:
                        coro.close()

            await asyncio.gather(*(guarded(self.read_feed(client, f)) for f in feeds))
            for url in frontier:
                self.push(url, depth=1)
            print(f"[spider] feeds read: {len(feeds)}; queue: {len(self.queue):,}")

            active: set[asyncio.Task] = set()
            busy: set[str] = set()
            last_report = 0
            while time.monotonic() < self.deadline and self.stats["fetched"] < self.max_pages:
                deferred = []
                while self.queue and len(active) < self.concurrency and len(deferred) < 2000:
                    # One page per site at a time: skip past sites already being fetched, so a slow site can't stall the rest.
                    item = heapq.heappop(self.queue)
                    host = host_of(item[2])
                    if host in busy:
                        deferred.append(item)
                        continue
                    busy.add(host)
                    task = asyncio.create_task(self.visit(client, item[2], item[3], item[4]))
                    task.add_done_callback(lambda _t, h=host: busy.discard(h))
                    active.add(task)
                for item in deferred:
                    heapq.heappush(self.queue, item)
                if not active:
                    break
                done, active = await asyncio.wait(active, timeout=5, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    if task.exception():
                        self.stats["errors"] += 1
                if self.stats["fetched"] >= last_report + 500:
                    last_report = self.stats["fetched"]
                    print(f"[spider] {self.stats} queue={len(self.queue):,}")
            for task in active:
                task.cancel()
        print(f"[spider] done: {self.stats}")

    def next_frontier(self, limit: int = 5000) -> list[str]:
        """Best not-yet-crawled URLs for the next run: the queue plus newly discovered links."""
        left = [item for item in self.queue if url_key(item[2]) not in self.seen]
        left.sort()
        urls = [item[2] for item in left[:limit]]
        extra = sorted(self.discovered, reverse=True)
        known = set(urls)
        for _, url in extra:
            if len(urls) >= limit:
                break
            if url not in known and url_key(url) not in self.seen:
                urls.append(url)
                known.add(url)
        return urls


def load_lines(path: str) -> list[str]:
    if not os.path.exists(path):
        return []
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        return [line.strip() for line in fh if line.strip() and not line.startswith("#")]


def save_lines(path: str, lines) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "wt", encoding="utf-8") as fh:
        for line in lines:
            fh.write(line + "\n")


def run(shard_path: str, ranks: Ranks, feeds_file: str, state_dir: str, budget_s: float, max_pages: int) -> dict:
    seen = set(load_lines(os.path.join(state_dir, "seen.txt.gz")))
    frontier = load_lines(os.path.join(state_dir, "frontier.txt.gz"))
    feeds = load_lines(feeds_file)
    shard = Shard(shard_path)
    spider = Spider(ranks, shard, seen, budget_s, max_pages)
    asyncio.run(spider.run(feeds, frontier))
    shard.close({"source": "mnxspider"})
    save_lines(os.path.join(state_dir, "seen.txt.gz"), sorted(seen)[-3_000_000:])
    save_lines(os.path.join(state_dir, "frontier.txt.gz"), spider.next_frontier())
    return spider.stats
