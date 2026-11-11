"""Shared pieces of the Mnx Spiders: the index format, URL rules and quality checks.

The index is a set of SQLite files ("shards"). Each shard holds pages (URL, title,
plain text, dates) and a full-text search table over them (SQLite FTS5, BM25 ranking).
New crawls add new shards; the search server reads all of them.
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

USER_AGENT = "MnxSpider/1.0 (+https://github.com/Tharunmaks/MASSWEB/blob/main/spider/README.md)"
BODY_CHARS = 1000  # text kept per page (smaller = more of the web fits); agents open the live page for the rest

SCHEMA = """
CREATE TABLE IF NOT EXISTS pages(
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  published TEXT NOT NULL DEFAULT '',
  crawled TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  quality REAL NOT NULL DEFAULT 0,
  digest TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS pages_digest ON pages(digest);
CREATE INDEX IF NOT EXISTS pages_host ON pages(host);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  title, body, host,
  content='pages', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2',
  detail=column, columnsize=0
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
"""


class Shard:
    """One index file being written."""

    def __init__(self, path: str):
        self.path = path
        self.db = sqlite3.connect(path)
        self.db.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;")
        self.db.executescript(SCHEMA)
        self.count = self.db.execute("SELECT count(*) FROM pages").fetchone()[0]
        self.digests: set[str] = {row[0] for row in self.db.execute("SELECT digest FROM pages")}
        self.per_host: dict[str, int] = {}

    def add(self, *, url: str, title: str, body: str, published: str = "", crawled: str = "", lang: str = "", source: str = "", quality: float = 0.0, host_cap: int = 0, image: str = "") -> bool:
        host = host_of(url)
        if host_cap and self.per_host.get(host, 0) >= host_cap:
            return False
        title = fix_mojibake(title)
        body = fix_mojibake(body)
        digest = text_digest(title + " " + body)
        if digest in self.digests:
            return False
        body = body[:BODY_CHARS]
        cur = self.db.execute(
            "INSERT OR IGNORE INTO pages(url,host,title,body,published,crawled,lang,source,quality,digest,image) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (url, host, title[:300], body, published, crawled, lang, source, quality, digest, image[:500]),
        )
        if not cur.rowcount:
            return False
        self.db.execute("INSERT INTO fts(rowid,title,body,host) VALUES(?,?,?,?)", (cur.lastrowid, title[:300], body, host.replace(".", " ")))
        self.digests.add(digest)
        self.per_host[host] = self.per_host.get(host, 0) + 1
        self.count += 1
        if self.count % 2000 == 0:
            self.db.commit()
        return True

    def close(self, meta: dict[str, str] | None = None) -> None:
        for key, value in (meta or {}).items():
            self.db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", (key, value))
        self.db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('pages',?)", (str(self.count),))
        self.db.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('built',?)", (now_iso(),))
        self.db.commit()
        self.db.execute("INSERT INTO fts(fts) VALUES('optimize')")
        # These lookups only help while building; the search server doesn't need them.
        self.db.execute("DROP INDEX IF EXISTS pages_digest")
        self.db.execute("DROP INDEX IF EXISTS pages_host")
        self.db.commit()
        self.db.execute("VACUUM")
        self.db.close()


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def host_of(url: str) -> str:
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def site_of(host: str) -> str:
    """Registrable-ish domain: news.bbc.co.uk -> bbc.co.uk, docs.python.org -> python.org."""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "com", "ac", "gov", "org", "net", "edu", "nic", "res", "gob"} and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|dclid$|msclkid$|mc_cid$|mc_eid$|_hsenc$|_hsmi$|ref$|ref_src$|igshid$|yclid$|cmpid$|ocid$|smid$)", re.I)


def normalize_url(raw: str) -> str | None:
    try:
        parts = urlsplit(raw.strip())
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    host = parts.hostname.lower()
    if re.fullmatch(r"[\d.]+|\[.*\]", host) or host in ("localhost",) or host.endswith((".local", ".internal", ".onion")):
        return None
    port = f":{parts.port}" if parts.port and parts.port not in (80, 443) else ""
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING.match(k)])
    path = parts.path or "/"
    return urlunsplit(("https" if parts.scheme == "https" else "http", host + port, path, query, ""))


def url_key(url: str) -> str:
    """Short stable id for a URL (used for the 'already seen' set)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").removeprefix("www.")
    return hashlib.sha1(f"{host}{parts.path.rstrip('/')}?{parts.query}".encode()).hexdigest()[:16]


WORD = re.compile(r"[a-z0-9]+")


def text_digest(text: str) -> str:
    """Same text (ignoring case, spacing and punctuation) gives the same digest."""
    words = WORD.findall(text.lower())[:400]
    return hashlib.sha1(" ".join(words).encode()).hexdigest()[:20]


STOPWORDS = set(
    "the of and to in a is that for it as was with be by on not he i this are or his from at which but have an they you were "
    "their one all we can her has there been if more when will would who so no she other its may these than them what up out "
    "about into only some could also then two after time our new your how most just over any where because".split()
)


def english_ratio(text: str) -> float:
    words = WORD.findall(text.lower()[:6000])
    if len(words) < 30:
        return 0.0
    return sum(1 for w in words if w in STOPWORDS) / len(words)


BAD_WORDS = re.compile(
    r"\b(porn|xxx|sex ?cam|escort|nude|hentai|casino|betting|slot ?gacor|viagra|cialis|onlyfans|camgirl|essay writing service|replica watches|payday loan)\b",
    re.I,
)
BAD_URL = re.compile(r"(/tag/|/tags/|/search[/?]|[?&](s|q|query|search)=|/page/\d+|/wp-login|/login|/signin|/cart|/checkout|/feed/?$|\.(jpg|png|gif|pdf|zip|mp4|mp3)$)", re.I)


def is_spammy(url: str, title: str, body: str) -> bool:
    if BAD_URL.search(url):
        return True
    sample = f"{url} {title} {body[:3000]}"
    return len(BAD_WORDS.findall(sample)) >= 2 or bool(BAD_WORDS.search(title)) or bool(BAD_WORDS.search(url))


BOILER = re.compile(
    r"(cookie|javascript|privacy policy|terms of (use|service)|all rights reserved|sign up|log ?in|subscribe|newsletter|skip to (main )?content|share (this|on)|follow us|copyright ©|accept all|powered by)",
    re.I,
)


MOJIBAKE = re.compile("[\u00c2\u00c3][\u0080-\u00bf]|\u00e2\u20ac")


def fix_mojibake(text: str) -> str:
    """Undo UTF-8 read as Latin-1/Windows-1252 ("â€™" -> "’")."""
    if not MOJIBAKE.search(text):
        return text
    for codec in ("cp1252", "latin-1"):
        try:
            return text.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return text


def clean_text(raw: str) -> str:
    """Keep sentence-like lines; drop menus, buttons and footers (works on Common Crawl WET text)."""
    keep: list[str] = []
    for line in raw.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        words = line.count(" ") + 1
        sentence = line[-1:] in ".!?\"'”)" and words >= 5
        if (sentence or words >= 14) and not (BOILER.search(line) and words < 30) and "{" not in line[:40]:
            keep.append(line)
    return "\n".join(keep)


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default
