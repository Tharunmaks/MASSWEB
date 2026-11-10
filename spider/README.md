# Mnx Spiders

Mass Web's own web crawler and search index, built for AI agents first.

How it works, the same way big search engines do:

1. **Crawl.** `MnxSpider` reads news and blog feeds for fresh pages, then follows links outward to discover new pages and new sites. It also imports pages from [Common Crawl](https://commoncrawl.org), the free public crawl of billions of pages.
2. **Index.** Each page's main text (no menus, ads or cookie banners) is stored with its URL, title, published date and crawl date in SQLite full-text "shards" with BM25 ranking.
3. **Answer.** The search server merges all shards and answers in plain text, so AI agents (Claude, ChatGPT, Gemini, Grok, Mnx) can read results directly.

## Being a good robot

MnxSpider identifies itself as `MnxSpider/1.0 (+https://github.com/Tharunmaks/MASSWEB/blob/main/spider/README.md)`, obeys `robots.txt` (including `Crawl-delay`), fetches one page at a time per site with at least a second between requests, honours `noindex`, and stays inside a time budget each run. To keep MnxSpider off your site, add to robots.txt:

```
User-agent: MnxSpider
Disallow: /
```

## Where things run (all free)

| Part | Where |
| --- | --- |
| Spiders | GitHub Actions: `.github/workflows/spiders.yml` (crawl every 4 hours, Common Crawl import daily) |
| Index | Private Hugging Face dataset `<you>/mnx-index` (shards + the spiders' memory) |
| Search server | Hugging Face Space `<you>/mnx-spiders` (Docker, free CPU) |
| Mass Search | Uses the index first, through `MNX_INDEX_URL` (defaults to `https://tharunmakes-mnx-spiders.hf.space`) |

## Setup (once)

1. Create a Hugging Face token with **Write** access: huggingface.co/settings/tokens.
2. In this GitHub repo: Settings → Secrets and variables → Actions → New repository secret, name `HF_TOKEN`, paste the token.
3. Actions tab → **Mnx Spiders** → Run workflow (mode `both`). The first run creates the dataset and the Space and uploads the first shards.

Optional repository variable `MAX_INDEX_GB` (default 40): when the index grows past it, the oldest crawl shards are removed first.

## Using the index

```
GET /search?q=QUERY            plain text: numbered results with URL, published date, crawl date, snippet
    &days=7  &site=bbc.co.uk  &n=20  &page=2  &format=json
GET /page?url=URL              stored text of one page
GET /stats                     size and freshness
POST /mcp                      MCP tools: search, get_page
GET /llms.txt                  guide for AI agents
```

## Run it locally

```
pip install -r requirements.txt
python -m mnx.run --local --mode both --wet-files 2 --minutes 2
cd server && INDEX_DIR=../out/shards uvicorn app:app --port 7860
```
