"""Keeps the index on a public GitHub Release. No extra secret: GitHub Actions' own token can publish to the repo's Releases.

The Release (tag index-latest) holds:
  manifest.json      the shards the search server should load, with their sizes
  *.db.gz            the index shards, compressed for a faster download
  state files        the spiders' memory, so each run continues where the last one stopped

The search server (Mass Web on Vercel) unpacks the shards into its temporary disk, which holds
about 500 MB, so the index is kept under MAX_INDEX_MB (default 450 MB, roughly 250,000+ pages).
"""

from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import time

TAG = "index-latest"
REPO = os.environ.get("GITHUB_REPOSITORY", "Tharunmaks/MASSWEB")
STATE_FILES = ["seen.txt.gz", "frontier.txt.gz", "cc_done.txt", "tranco_pos.txt"]


def gh(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result


def ensure_release() -> None:
    if gh("release", "view", TAG, "-R", REPO, check=False).returncode != 0:
        gh("release", "create", TAG, "-R", REPO, "--title", "Mnx Index", "--notes", "Index shards built by the Mnx Spiders. Mass Web's search server reads them.", "--latest=false")


def download_state(state_dir: str) -> None:
    ensure_release()
    os.makedirs(state_dir, exist_ok=True)
    for name in STATE_FILES + ["manifest.json"]:
        gh("release", "download", TAG, "-R", REPO, "-p", name, "-D", state_dir, "--clobber", check=False)


def load_manifest(state_dir: str) -> dict:
    try:
        with open(os.path.join(state_dir, "manifest.json"), encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data.get("shards"), list):
            return data
    except (OSError, ValueError):
        pass
    return {"shards": []}


def publish(shard_paths: list[str], state_dir: str, max_mb: float) -> None:
    ensure_release()
    manifest = load_manifest(state_dir)
    entries = {s["name"]: s for s in manifest["shards"] if isinstance(s, dict) and s.get("name")}

    uploads: list[str] = []
    new_names: set[str] = set()
    for path in shard_paths:
        if not os.path.exists(path) or os.path.getsize(path) < 50_000:
            continue
        gz = path + ".gz"
        with open(path, "rb") as src, gzip.open(gz, "wb", compresslevel=6) as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        name = os.path.basename(gz)
        entries[name] = {"name": name, "size": os.path.getsize(path), "gz": os.path.getsize(gz), "added": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        uploads.append(gz)
        new_names.add(name)

    # Stay under the size the search server can unpack: the oldest shards go first, so the index is a rolling window.
    limit = int(max_mb * 1_000_000)
    total = sum(e["size"] for e in entries.values())
    for name in sorted(entries, key=lambda n: (entries[n].get("added", ""), n)):
        if total <= limit:
            break
        if name in new_names:
            continue
        total -= entries.pop(name)["size"]
        gh("release", "delete-asset", TAG, name, "-R", REPO, "-y", check=False)
        print(f"[release] dropped {name} to stay under {max_mb:.0f} MB")

    manifest = {"shards": sorted(entries.values(), key=lambda e: e["name"]), "total": total, "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    manifest_path = os.path.join(state_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)

    # Shards first, manifest last, so the server never sees a manifest pointing at a missing file.
    if uploads:
        gh("release", "upload", TAG, *uploads, "-R", REPO, "--clobber")
    state = [os.path.join(state_dir, n) for n in STATE_FILES if os.path.exists(os.path.join(state_dir, n))]
    gh("release", "upload", TAG, *state, manifest_path, "-R", REPO, "--clobber")
    print(f"[release] {len(entries)} shards, {total / 1e6:.0f} MB of {max_mb:.0f} MB")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(f"### Mnx Spiders\n\n- Index: {len(entries)} shards, {total / 1e6:.0f} MB of {max_mb:.0f} MB\n- Published to the `{TAG}` release\n")
