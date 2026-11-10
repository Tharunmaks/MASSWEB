---
title: Mnx Index
emoji: 🕷️
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Web search index for AI agents, crawled by the Mnx Spiders
---

# Mnx Index

Search over pages crawled by the Mnx Spiders and imported from Common Crawl. Built for AI agents: answers are plain text.

- `GET /search?q=...` (add `days=7`, `site=example.com`, `n=20`, `page=2`, `format=json`)
- `GET /page?url=...`
- `GET /stats`
- `POST /mcp` (MCP tools: `search`, `get_page`)
- `GET /llms.txt`

Source: https://github.com/Tharunmaks/MASSWEB/tree/main/spider
