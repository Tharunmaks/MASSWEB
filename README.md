# Mass Web

A fast, private web browser for your phone, and a browser for AI agents, built from scratch.

## Features

- **Browsing:** bottom address bar, swipe between tabs, tab grid with spaces and search, incognito, split view, link previews, pull-to-refresh, find in page, history, bookmarks, command palette (`>` or Ctrl+K).
- **Privacy:** built-in ad and tracker blocker (EasyList / uBlock-style filters) with a privacy dashboard, tracking-parameter stripping, every page loaded through your own server.
- **Reading:** reader mode, read aloud, translate any page, save for offline, data saver, desktop-site mode, dark mode for any site.
- **Make sites yours:** Boosts (zap elements, custom CSS per site), highlights and notes, live RSS / GitHub feeds.
- **Power tools:** page info and view source, QR codes, downloads, backup and restore.
- **For AI agents:** an MCP server and REST API so AI models can browse through Mass Web instead of Chrome.

## How it's hosted

Mass Web has two parts:

| Part | What it does | Where it runs |
| --- | --- | --- |
| **App** | The browser you use on your phone | **GitHub Pages** (static, free) |
| **Page server** | Fetches websites, blocks ads, reader mode, feeds, agent API | **Vercel** free Hobby plan |

GitHub Pages can only serve static files, so the page server runs on Vercel. The full app also works directly on the Vercel address.

### 1. Page server on Vercel (once)

1. Go to vercel.com and sign in with GitHub (free Hobby plan, no card).
2. **Add New → Project**, import this repo, keep the defaults (`vercel.json` sets everything), and **Deploy**.
3. Copy the address Vercel gives you, e.g. `massweb.vercel.app`.

Every push to `main` redeploys it automatically.

### 2. App on GitHub Pages (once)

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Optional: **Settings → Secrets and variables → Actions → Variables → New variable** `MASSWEB_SERVER` = your Vercel address, so the app connects without asking.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow). The app appears at `https://<user>.github.io/<repo>/`.

On first open, the app asks for your server address if `MASSWEB_SERVER` isn't set. You can change it in **Settings → Page server**, or open the app with `?server=massweb.vercel.app`.

## For AI agents

Pages come back as clean Markdown with numbered links and forms, with ads and trackers blocked.

- **MCP server:** `https://<your-server>/mcp` (Streamable HTTP). Tools: `web_search`, `open_page`, `follow_link`, `find_in_page`, `submit_form`.
- **REST:** `/api/agent/search?q=`, `/api/agent/read?url=`, `/api/agent/follow?url=&n=`, `/api/agent/find?url=&q=`, `POST /api/agent/submit`. Add `&format=text` for plain text.
- **Guide for models:** `/llms.txt`
- **Access:** set `MASSWEB_AGENT_KEY` in Vercel's environment variables to require `Authorization: Bearer <key>`. Every caller is limited to 120 calls per 10 minutes. Password fields are never filled.

```json
{ "mcpServers": { "mass-web": { "type": "http", "url": "https://<your-server>/mcp" } } }
```

## Code

- `src/components/massweb/`: the browser UI
- `src/lib/browser/`: proxy, injected page script, state, ad blocking, reader, agent tools
- `src/routes/`: server routes (`view`, `reader`, `suggest`, `feed`, `dl`, `source`, `health`, `mcp`, `api/agent/*`, `llms.txt`)
- `pages/` + `vite.pages.config.ts`: the static GitHub Pages build

```sh
npm install
npm run dev          # full app + server on http://localhost:8080
npm run dev:pages    # Pages app on http://localhost:8090 (connect it to :8080)
npm run build        # server build for Vercel
npm run build:pages  # static app for GitHub Pages
```
