"""Site popularity from the Tranco list (a research-grade ranking of the top 1 million sites).

Used two ways: pages from ranked sites (and .gov / .edu / .ac.* sites) are let into the index,
which keeps most spam out, and a better rank gives a page a small boost in results.
"""

from __future__ import annotations

import io
import math
import os
import urllib.request
import zipfile

from .common import USER_AGENT, site_of

TRANCO_URL = "https://tranco-list.eu/top-1m.csv.zip"

# Sites where anyone can host a subdomain. "blog" platforms carry a lot of real writing and are let in
# at low weight; "host" platforms are mostly throwaway or spam pages and only count if ranked themselves.
HOSTING = {
    **dict.fromkeys(["blogspot.com", "wordpress.com", "medium.com", "substack.com", "github.io", "gitlab.io", "tumblr.com", "livejournal.com", "hashnode.dev", "dev.to", "ghost.io", "readthedocs.io", "bearblog.dev"], "blog"),
    **dict.fromkeys(["workers.dev", "pages.dev", "netlify.app", "vercel.app", "web.app", "firebaseapp.com", "herokuapp.com", "glitch.me", "weebly.com", "wixsite.com", "webflow.io", "000webhostapp.com", "azurewebsites.net", "amazonaws.com", "cloudfront.net", "onrender.com", "fly.dev", "repl.co", "framer.website", "carrd.co", "square.site", "mystrikingly.com", "jimdofree.com", "blogger.com", "sites.google.com"], "host"),
}


class Ranks:
    def __init__(self, ranks: dict[str, int]):
        self.ranks = ranks

    @classmethod
    def load(cls, cache: str = "state/tranco.csv") -> "Ranks":
        text = ""
        if os.path.exists(cache) and os.path.getsize(cache) > 1_000_000:
            with open(cache, encoding="utf-8") as fh:
                text = fh.read()
        else:
            try:
                req = urllib.request.Request(TRANCO_URL, headers={"user-agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=60) as res:
                    data = res.read()
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    text = zf.read(zf.namelist()[0]).decode("utf-8")
                os.makedirs(os.path.dirname(cache) or ".", exist_ok=True)
                with open(cache, "w", encoding="utf-8") as fh:
                    fh.write(text)
            except Exception as error:  # noqa: BLE001 - work without ranks rather than fail
                print(f"[ranks] couldn't load the Tranco list: {error}")
        ranks: dict[str, int] = {}
        for line in text.splitlines():
            rank, _, domain = line.partition(",")
            if domain and rank.isdigit():
                ranks.setdefault(domain.strip().lower(), int(rank))
        print(f"[ranks] {len(ranks):,} ranked sites")
        return cls(ranks)

    def rank(self, host: str) -> int:
        site = site_of(host)
        if host != site and site in HOSTING:
            # Anyone can make a site on these; the platform's rank says nothing about the site.
            return self.ranks.get(host, 0)
        return self.ranks.get(host) or self.ranks.get(site) or 0

    def platform(self, host: str) -> str:
        site = site_of(host)
        return HOSTING.get(site, "") if host != site else ""

    def trusted_tld(self, host: str) -> bool:
        parts = host.split(".")
        return parts[-1] in ("gov", "edu", "mil", "int") or (len(parts) >= 3 and parts[-2] in ("gov", "ac", "edu", "nic", "res"))

    def allowed(self, host: str) -> bool:
        if self.rank(host) or self.trusted_tld(host):
            return True
        return self.platform(host) == "blog"

    def quality(self, host: str) -> float:
        """0..1: 1 for the very top sites, ~0.2 near rank 1,000,000, 0.25 for .gov/.edu without a rank."""
        rank = self.rank(host)
        if not rank:
            if self.trusted_tld(host):
                return 0.25
            return 0.12 if self.platform(host) == "blog" else 0.0
        return max(0.05, 1.0 - math.log10(rank) / 7.5)
