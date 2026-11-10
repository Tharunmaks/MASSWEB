# Mass Web

A fast, private, AI-powered web browser for your phone, built from scratch as a web app.

## What it does

- **Browsing:** bottom address bar, swipe between tabs, tab grid with spaces, incognito, split view, link previews, pull-to-refresh, find in page, history, bookmarks.
- **Privacy:** built-in ad and tracker blocker (EasyList / uBlock-style filters) with a privacy dashboard, tracking-parameter stripping, private proxy for every page.
- **Reading:** reader mode, read aloud, translate any page, save for offline, data saver, desktop-site mode, dark mode for any site.
- **Make sites yours:** Boosts (zap elements, custom CSS per site), highlights and notes, live RSS / GitHub feeds.
- **AI (Grok):** ask about a page, compare tabs, web answers with sources from the address bar, saved Skills, explain selected text, summarize links, AI Tidy Tabs.
- **Power tools:** command palette (`>` or Ctrl+K), page info and view source, QR codes, downloads, backup and restore.

## For AI agents

Mass Web is also a browser for AI models and agents (Claude, Grok, custom agents, scripts). Pages come back as clean Markdown with numbered links and forms, with ads and trackers blocked.

- **MCP server:** `https://<your-app>/mcp` (Streamable HTTP). Tools: `web_search`, `open_page`, `follow_link`, `find_in_page`, `submit_form`, `ask_page`.
- **REST:** `/api/agent/search?q=`, `/api/agent/read?url=`, `/api/agent/follow?url=&n=`, `/api/agent/find?url=&q=`, `POST /api/agent/submit`, `POST /api/agent/ask`. Add `&format=text` for plain text.
- **Guide for models:** `/llms.txt`
- **Access:** set `MASSWEB_AGENT_KEY` to require `Authorization: Bearer <key>`. Every caller is limited to 120 calls per 10 minutes. Password fields are never filled.

MCP client config:

```json
{ "mcpServers": { "mass-web": { "type": "http", "url": "https://<your-app>/mcp" } } }
```

## How it works

The shell is a React + TanStack Start app. Pages are fetched by a server-side proxy (`/view`), rewritten (absolute URLs, ad blocking, an injected bridge script) and shown in sandboxed iframes. The injected script (`src/lib/browser/inject.ts`) routes navigation back to the shell and powers find, dark mode, zap, highlights, translation and selection actions.

Key folders:

- `src/components/massweb/` – the browser UI
- `src/lib/browser/` – proxy, injected script, state, ad blocking, AI, reader
- `src/routes/` – server routes: `view`, `reader`, `suggest`, `ai`, `feed`, `dl`, `source`

## Running

```sh
npm install
npm run dev        # http://localhost:8080
npm run build
```

AI features need `XAI_API_KEY` in the server environment (the Grok app builder adds it on publish).
