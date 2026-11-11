# Mnx Spiders

Mass Web's own web crawler and search index, built for AI agents first.

How it works, the same way big search engines do:

1. **Crawl.** `MnxSpider` reads news and blog feeds for fresh pages, visits the front pages of the world's top sites (a few thousand per run, working down the Tranco list), then follows links outward to discover new pages and new sites. It also imports pages from [Common Crawl](https://commoncrawl.org), the free public crawl of billions of pages.
2. **Index.** Each page's main text (no menus, ads or cookie banners) is stored with its URL, title, published date and crawl date in SQLite full-text "shards" with BM25 ranking.
3. **Answer.** Mass Web's server merges all shards and answers in plain text, so AI agents (Claude, ChatGPT, Gemini, Grok, Mnx) can read results directly.

## Being a good robot

MnxSpider identifies itself as `MnxSpider/1.0 (+https://github.com/Tharunmaks/MASSWEB/blob/main/spider/README.md)`, obeys `robots.txt` (including `Crawl-delay`), fetches one page at a time per site with at least a second between requests, honours `noindex`, and stays inside a time budget each run. To keep MnxSpider off your site, add to robots.txt:

```
User-agent: MnxSpider
Disallow: /
```

## Where things run (all free, no secrets)

| Part | Where |
| --- | --- |
| Spiders | GitHub Actions: `.github/workflows/spiders.yml` (crawl every 4 hours, Common Crawl import twice a day) |
| Index | The repo's public `index-latest` release: compressed shards plus `manifest.json` and the spiders' memory. GitHub Actions' built-in token publishes it. |
| Search | Mass Web itself on Vercel (`/mnx/...`): it downloads the shards into its temporary disk and searches them with Node's built-in SQLite. Mass Search asks it first. |

The index is a rolling window kept under `MAX_INDEX_MB` (default 450 MB, about 250,000 pages), because Vercel's temporary disk holds about 500 MB. When it's full, the oldest shards are dropped first.

## Setup

Nothing to configure. Actions tab → **Mnx Spiders** → Run workflow (mode `both`) to build the first index now; after that it runs on its own.

## Using the index

On Mass Web's server:

```
GET /mnx/search?q=QUERY        plain text: numbered results with URL, published date, crawl date, snippet
    &days=7  &site=bbc.co.uk  &n=20  &page=2  &format=json
GET /mnx/images?q=QUERY        pictures: image URL and the page each came from
GET /mnx/page?url=URL          stored text of one page
GET /mnx/stats                 size and freshness
```

Mass Web's MCP tools (`web_search`, `image_search`, `research`) include the index automatically.

## Run it locally

```
pip install -r requirements.txt
python -m mnx.run --local --mode both --wet-files 2 --minutes 2
# then point Mass Web at the shards: MNX_INDEX_DIR=out/shards (and put a manifest there), or publish a release
```
