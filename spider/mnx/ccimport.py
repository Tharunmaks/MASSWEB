"""Import pages from Common Crawl, the free public crawl of billions of web pages.

Common Crawl publishes "WET" files: the plain text of every page it crawled, about
20,000 pages per file. We stream files from the newest crawl, keep English pages from
ranked sites that read like real content, and add them to a shard.
"""

from __future__ import annotations

import gzip
import io
import os
import random
import urllib.request

from warcio.archiveiterator import ArchiveIterator

from .common import USER_AGENT, Shard, clean_text, english_ratio, host_of, is_spammy, normalize_url
from .ranks import Ranks

BASE = "https://data.commoncrawl.org/"
FALLBACK_CRAWL = "CC-MAIN-2026-43"


def _get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"user-agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def latest_crawl() -> str:
    """The newest crawl id, e.g. CC-MAIN-2026-43."""
    try:
        import json

        crawls = json.loads(_get("https://index.commoncrawl.org/collinfo.json", 30))
        return crawls[0]["id"]
    except Exception as error:  # noqa: BLE001
        print(f"[cc] couldn't read the crawl list ({error}); using {FALLBACK_CRAWL}")
        return FALLBACK_CRAWL


def wet_paths(crawl: str) -> list[str]:
    return gzip.decompress(_get(f"{BASE}crawl-data/{crawl}/wet.paths.gz")).decode().split()


def import_file(path: str, shard: Shard, ranks: Ranks, host_cap: int = 40) -> tuple[int, int]:
    """Stream one WET file into the shard. Returns (pages seen, pages kept)."""
    seen = kept = 0
    req = urllib.request.Request(BASE + path, headers={"user-agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as res:
        data = io.BytesIO(res.read())
    for record in ArchiveIterator(data):
        if record.rec_type != "conversion":
            continue
        seen += 1
        headers = record.rec_headers
        langs = (headers.get_header("WARC-Identified-Content-Language") or "").split(",")
        if not langs or langs[0] != "eng":
            continue
        url = normalize_url(headers.get_header("WARC-Target-URI") or "")
        if not url:
            continue
        host = host_of(url)
        if not ranks.allowed(host):
            continue
        raw = record.content_stream().read().decode("utf-8", "replace")
        first, _, rest = raw.partition("\n")
        title = first.strip()[:300]
        body = clean_text(rest)
        if len(body) < 500 or english_ratio(body) < 0.12:
            continue
        if is_spammy(url, title, body):
            continue
        crawled = (headers.get_header("WARC-Date") or "")[:20]
        if shard.add(url=url, title=title, body=body, crawled=crawled, lang="en", source="commoncrawl", quality=ranks.quality(host), host_cap=host_cap):
            kept += 1
    return seen, kept


def run(shard_path: str, ranks: Ranks, files: int, done: set[str], crawl: str | None = None) -> list[str]:
    """Import `files` WET files not imported before. Returns the paths imported."""
    crawl = crawl or latest_crawl()
    paths = [p for p in wet_paths(crawl) if p not in done]
    # A random spread across the crawl gives a broader mix of sites than consecutive files.
    random.Random(len(done)).shuffle(paths)
    shard = Shard(shard_path)
    imported: list[str] = []
    for path in paths[:files]:
        try:
            seen, kept = import_file(path, shard, ranks)
            imported.append(path)
            print(f"[cc] {os.path.basename(path)}: kept {kept:,} of {seen:,} pages (shard: {shard.count:,})")
        except Exception as error:  # noqa: BLE001 - skip a bad file, keep going
            print(f"[cc] {path} failed: {error}")
    shard.close({"source": "commoncrawl", "crawl": crawl, "files": str(len(imported))})
    return imported
