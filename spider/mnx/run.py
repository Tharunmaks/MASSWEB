"""One run of the Mnx Spiders, as GitHub Actions calls it.

  python -m mnx.run --mode crawl     read feeds and crawl outward (every few hours)
  python -m mnx.run --mode import    add pages from Common Crawl (daily)
  python -m mnx.run --mode both

The index is kept on a public GitHub Release (see releases.py). GitHub Actions' built-in
token is all it needs, so there is no secret to set. --local builds shards in ./out for testing.
"""

from __future__ import annotations

import argparse
import os
import shutil
import time

from . import ccimport, crawl
from .common import env_int
from .ranks import Ranks

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="both", choices=["crawl", "import", "both"])
    parser.add_argument("--wet-files", type=int, default=env_int("WET_FILES", 200))
    parser.add_argument("--minutes", type=float, default=env_int("CRAWL_MINUTES", 30))
    parser.add_argument("--max-pages", type=int, default=env_int("CRAWL_MAX_PAGES", 20000))
    parser.add_argument("--max-index-mb", type=float, default=env_int("MAX_INDEX_MB", 450))
    parser.add_argument("--local", action="store_true")
    parser.add_argument("--work", default=os.path.join(HERE, "out"))
    args = parser.parse_args()

    work = args.work
    state = os.path.join(work, "state")
    shards = os.path.join(work, "shards")
    os.makedirs(state, exist_ok=True)
    os.makedirs(shards, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M", time.gmtime())

    release = None
    if not args.local:
        from . import releases

        release = releases
        release.download_state(state)

    ranks = Ranks.load(os.path.join(state, "tranco.csv"))
    made: list[str] = []

    if args.mode in ("import", "both") and args.wet_files > 0:
        done_file = os.path.join(state, "cc_done.txt")
        done = set(crawl.load_lines(done_file))
        crawl_id = ccimport.latest_crawl()
        path = os.path.join(shards, f"cc-{crawl_id}-{stamp}.db")
        imported = ccimport.run(path, ranks, args.wet_files, done, crawl_id, minutes=150)
        crawl.save_lines(done_file, sorted(done | set(imported)))
        made.append(path)

    if args.mode in ("crawl", "both"):
        path = os.path.join(shards, f"spider-{stamp}.db")
        stats = crawl.run(path, ranks, os.path.join(HERE, "seeds", "feeds.txt"), state, args.minutes * 60, args.max_pages)
        print(f"[run] crawl: {stats}")
        made.append(path)

    for path in made:
        print(f"[run] built {os.path.basename(path)}: {os.path.getsize(path) / 1e6:.1f} MB")

    if release:
        release.publish(made, state, args.max_index_mb)
        shutil.rmtree(shards, ignore_errors=True)


if __name__ == "__main__":
    main()
