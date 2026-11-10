# Mass Web

A fast, private, AI-powered web browser for your phone, built from scratch as a web app.

## What it does

- **Browsing:** bottom address bar, swipe between tabs, tab grid with spaces, incognito, split view, link previews, pull-to-refresh, find in page, history, bookmarks.
- **Privacy:** built-in ad and tracker blocker (EasyList / uBlock-style filters) with a privacy dashboard, tracking-parameter stripping, private proxy for every page.
- **Reading:** reader mode, read aloud, translate any page, save for offline, data saver, desktop-site mode, dark mode for any site.
- **Make sites yours:** Boosts (zap elements, custom CSS per site), highlights and notes, live RSS / GitHub feeds.
- **AI (Grok):** ask about a page, compare tabs, web answers with sources from the address bar, saved Skills, explain selected text, summarize links, AI Tidy Tabs.
- **Power tools:** command palette (`>` or Ctrl+K), page info and view source, QR codes, downloads, backup and restore.

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
