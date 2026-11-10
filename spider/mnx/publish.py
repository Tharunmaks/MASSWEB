"""Keeps the index and the search server on the token owner's Hugging Face account."""

from __future__ import annotations

import os

from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi
from huggingface_hub.utils import EntryNotFoundError, RepositoryNotFoundError

STATE_FILES = ["seen.txt.gz", "frontier.txt.gz", "cc_done.txt"]


class Hub:
    def __init__(self, token: str):
        self.api = HfApi(token=token)
        self.token = token
        self.user = self.api.whoami()["name"]
        self.dataset = os.environ.get("INDEX_REPO") or f"{self.user}/mnx-index"
        self.space = os.environ.get("SPACE_REPO") or f"{self.user}/mnx-spiders"
        print(f"[hub] dataset {self.dataset}, Space {self.space}")

    def ensure(self, server_dir: str) -> None:
        """Create the private index dataset and the search Space if needed, and deploy the server code."""
        self.api.create_repo(self.dataset, repo_type="dataset", private=True, exist_ok=True)
        created = False
        try:
            self.api.repo_info(self.space, repo_type="space")
        except RepositoryNotFoundError:
            self.api.create_repo(self.space, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
            created = True
        if created:
            # The Space reads the private dataset with this token.
            self.api.add_space_secret(self.space, "HF_TOKEN", self.token)
            self.api.add_space_variable(self.space, "INDEX_REPO", self.dataset)
        self.api.upload_folder(
            folder_path=server_dir,
            repo_id=self.space,
            repo_type="space",
            allow_patterns=["*.py", "Dockerfile", "requirements.txt", "README.md"],
            commit_message="Update the Mnx Index server",
        )

    def pull_state(self, state_dir: str) -> None:
        for name in STATE_FILES:
            try:
                self.api.hf_hub_download(self.dataset, f"state/{name}", repo_type="dataset", local_dir=os.path.dirname(state_dir))
            except (EntryNotFoundError, RepositoryNotFoundError):
                pass
            except Exception as error:  # noqa: BLE001
                print(f"[hub] couldn't fetch state/{name}: {error}")

    def push(self, shard_paths: list[str], state_dir: str) -> None:
        ops = [CommitOperationAdd(f"shards/{os.path.basename(p)}", p) for p in shard_paths if os.path.exists(p) and os.path.getsize(p) > 50_000]
        ops += [CommitOperationAdd(f"state/{n}", os.path.join(state_dir, n)) for n in STATE_FILES if os.path.exists(os.path.join(state_dir, n))]
        if ops:
            self.api.create_commit(self.dataset, ops, repo_type="dataset", commit_message=f"Spiders: {', '.join(os.path.basename(p) for p in shard_paths)}")
            print(f"[hub] uploaded {len(ops)} files")

    def shards(self) -> list[tuple[str, int]]:
        out = []
        for item in self.api.list_repo_tree(self.dataset, repo_type="dataset", path_in_repo="shards"):
            size = getattr(item, "size", None)
            if size is not None:
                out.append((item.path, int(size)))
        return out

    def trim(self, max_gb: float) -> None:
        """Keep the index under max_gb: drop the oldest crawl shards first (old news ages fastest), then the oldest imports."""
        shards = self.shards()
        total = sum(size for _, size in shards)
        limit = int(max_gb * 1e9)
        if total <= limit:
            return
        order = sorted(shards, key=lambda s: (0 if "/spider-" in s[0] else 1, s[0]))
        drop = []
        for path, size in order:
            if total <= limit:
                break
            drop.append(path)
            total -= size
        self.api.create_commit(self.dataset, [CommitOperationDelete(p) for p in drop], repo_type="dataset", commit_message=f"Trim index to {max_gb} GB")
        print(f"[hub] removed {len(drop)} old shards")

    def summary(self) -> None:
        shards = self.shards()
        size = sum(s for _, s in shards) / 1e9
        print(f"[hub] index: {len(shards)} shards, {size:.2f} GB")
        print(f"[hub] search server: https://{self.space.replace('/', '-').replace('_', '-').replace('.', '-').lower()}.hf.space")
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as fh:
                fh.write(f"### Mnx Spiders\n\n- Index: {len(shards)} shards, {size:.2f} GB\n- Search: https://{self.space.replace('/', '-').lower()}.hf.space/search?q=hello\n")
