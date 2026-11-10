"""Search over the Mnx index: every shard is a SQLite FTS5 file; results are merged and ranked.

Ranking = BM25 text relevance (title counts most) x site quality, plus boosts for fresh
pages, for a site's home page on a site-name query, and for words appearing together.
"""

from __future__ import annotations

import calendar
import glob
import math
import os
import re
import sqlite3
import threading
import time
from dataclasses import dataclass, field

WORD = re.compile(r"[\w][\w'.+-]*", re.UNICODE)
SITE = re.compile(r"\bsite:([a-z0-9.-]+)", re.I)


@dataclass
class Hit:
    url: str
    host: str
    title: str
    snippet: str
    published: str
    crawled: str
    source: str
    score: float
    digest: str
    body: str = field(default="", repr=False)


class Index:
    def __init__(self, folder: str):
        self.folder = folder
        self.lock = threading.Lock()
        self.shards: dict[str, sqlite3.Connection] = {}
        self.pages = 0
        self.hosts = 0
        self.refreshed = ""
        self.refresh()

    def refresh(self) -> None:
        paths = sorted(glob.glob(os.path.join(self.folder, "**", "*.db"), recursive=True))
        with self.lock:
            for path in paths:
                if path in self.shards:
                    continue
                try:
                    db = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True, check_same_thread=False)
                    db.execute("SELECT 1 FROM fts LIMIT 1")
                    self.shards[path] = db
                except sqlite3.Error as error:
                    print(f"[index] skipping {path}: {error}")
            for path in [p for p in self.shards if p not in paths]:
                self.shards.pop(path).close()
            pages = 0
            for db in self.shards.values():
                pages += db.execute("SELECT count(*) FROM pages").fetchone()[0]
            self.pages = pages
            self.refreshed = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        print(f"[index] {len(self.shards)} shards, {self.pages:,} pages")

    @staticmethod
    def fts_query(words: list[str], mode: str) -> str:
        quoted = ['"' + w.replace('"', "") + '"' for w in words]
        if mode == "and":
            return " ".join(quoted)
        return " OR ".join(quoted)

    def search(self, query: str, n: int = 10, offset: int = 0, days: int = 0, site: str = "") -> tuple[list[Hit], int]:
        query = query.strip()[:300]
        site_match = SITE.search(query)
        if site_match:
            site = site or site_match.group(1).lower()
            query = SITE.sub(" ", query)
        words = [w.lower().strip(".'-+") for w in WORD.findall(query)]
        words = [w for w in words if w][:12]
        if not words:
            return [], 0
        want = offset + n
        per_shard = max(want * 3, 30)
        since = ""
        if days:
            since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - days * 86400))
        hits: list[Hit] = []
        for mode in ("and", "or"):
            hits = self._query(self.fts_query(words, mode), per_shard, since, site, words, query)
            if len(hits) >= want or mode == "or" or len(words) == 1:
                break
        # Same story at two addresses (or a page copied elsewhere) counts once.
        seen_url: set[str] = set()
        seen_digest: set[str] = set()
        unique: list[Hit] = []
        for hit in sorted(hits, key=lambda h: h.score, reverse=True):
            key = hit.url.split("://", 1)[-1].removeprefix("www.").rstrip("/")
            if key in seen_url or hit.digest in seen_digest:
                continue
            seen_url.add(key)
            seen_digest.add(hit.digest)
            unique.append(hit)
        # Keep results varied: at most 3 per site in the top list.
        per_host: dict[str, int] = {}
        varied: list[Hit] = []
        spill: list[Hit] = []
        for hit in unique:
            per_host[hit.host] = per_host.get(hit.host, 0) + 1
            (varied if per_host[hit.host] <= 3 or site else spill).append(hit)
        ranked = varied + spill
        return ranked[offset:want], len(ranked)

    def _query(self, match: str, limit: int, since: str, site: str, words: list[str], raw: str) -> list[Hit]:
        sql = (
            "SELECT p.url, p.host, p.title, snippet(fts, 1, '', '', ' … ', 36), p.published, p.crawled, p.source, p.quality, p.digest, p.lang,"
            " bm25(fts, 10.0, 1.0, 4.0) AS rank"
            " FROM fts JOIN pages p ON p.id = fts.rowid WHERE fts MATCH ?"
        )
        args: list[object] = [match]
        if since:
            sql += " AND p.published >= ?"
            args.append(since)
        if site:
            sql += " AND (p.host = ? OR p.host LIKE ?)"
            args += [site.removeprefix("www."), "%." + site.removeprefix("www.")]
        sql += " ORDER BY rank LIMIT ?"
        args.append(limit)
        now = time.time()
        phrase = " ".join(words)
        english = all(w.isascii() for w in words)
        out: list[Hit] = []
        with self.lock:
            shards = list(self.shards.values())
        for db in shards:
            try:
                rows = db.execute(sql, args).fetchall()
            except sqlite3.Error as error:
                print(f"[search] {error}")
                continue
            for url, host, title, snippet, published, crawled, source, quality, digest, lang, rank in rows:
                relevance = -rank  # bm25(): lower is better
                score = relevance * (0.55 + quality)
                if english and lang != "en":
                    score *= 0.6
                title_l = title.lower()
                if phrase in title_l:
                    score *= 1.35
                if phrase in snippet.lower():
                    score *= 1.1
                # Navigational queries: "github" or "bbc news" should put the site itself first.
                compact = phrase.replace(" ", "")
                path = url.split("://", 1)[-1].split("/", 1)[-1] if "/" in url.split("://", 1)[-1] else ""
                if compact and (host.split(".")[0] == compact or host.replace(".", "").startswith(compact)):
                    score *= 2.2 if len(path.strip("/")) == 0 else 1.4
                stamp = published or ""
                if stamp:
                    try:
                        age_days = max(0.0, (now - calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))) / 86400)
                        score *= 1 + 0.25 * math.exp(-age_days / 14)
                    except ValueError:
                        pass
                out.append(Hit(url, host, title, re.sub(r"\s+", " ", snippet).strip(), published, crawled, source, score, digest))
        return out

    def page(self, url: str) -> Hit | None:
        with self.lock:
            shards = list(self.shards.values())
        variants = {url, url.rstrip("/"), url.rstrip("/") + "/", url.replace("://www.", "://"), url.replace("://", "://www.", 1)}
        best: Hit | None = None
        for db in shards:
            for v in variants:
                row = db.execute("SELECT url, host, title, body, published, crawled, source, digest FROM pages WHERE url = ?", (v,)).fetchone()
                if row and (best is None or row[5] > best.crawled):
                    best = Hit(row[0], row[1], row[2], "", row[4], row[5], row[6], 0.0, row[7], row[3])
        return best

    def stats(self) -> dict:
        with self.lock:
            shards = list(self.shards.items())
        newest = ""
        sources: dict[str, int] = {}
        for _, db in shards:
            for source, count in db.execute("SELECT source, count(*) FROM pages GROUP BY source"):
                sources[source] = sources.get(source, 0) + count
            row = db.execute("SELECT max(published) FROM pages WHERE published <= strftime('%Y-%m-%dT%H:%M:%SZ','now')").fetchone()
            if row and row[0] and row[0] > newest:
                newest = row[0]
        return {"pages": self.pages, "shards": len(shards), "by_source": sources, "newest_page": newest, "refreshed": self.refreshed}
