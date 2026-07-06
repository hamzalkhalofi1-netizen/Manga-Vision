---
name: MangaFire backend (2026 rewrite — JSON API)
description: MangaFire migrated to a client-rendered SPA; use its first-party JSON REST API instead of HTML/AJAX scraping or Cloudflare WebView bypass
---

## Discovery (confirmed July 2026)
mangafire.to migrated to a fully client-rendered SPA. Plain HTML fetches of `/filter`, `/manga/{slug}`, `/home`, etc. return only an empty JS-shell with no manga data — the old AJAX/HTML-scraping approach (`/ajax/manga/{id}/chapter/en`, `data-number` parsing, `/ajax/read/{token}/...`) described in earlier versions of this note is now dead and returns nothing useful.

## Current approach: first-party JSON REST API
The SPA's own frontend calls a JSON API at `${SITE_URL}/api/*` (axios baseURL `/api`, headers `Accept: application/json`, `X-Requested-With: XMLHttpRequest`). Confirmed via direct `curl` with **no cookies and no Cloudflare challenge** — no WebView bridge, no cf_clearance, no session/token dance needed at all.

Endpoints (reverse-engineered from the production JS bundle, `s.mfcdn.nl`):
- `GET /api/titles?sort=...&page=...&keyword=...` → `{items:[...]}` (listing/search; sort values include `rank`, `chapter_updated_at:desc`, `relevance:desc`)
- `GET /api/top-titles` → `{items:[...]}` (curated trending)
- `GET /api/titles/{hid}` → `{data:{...}}` (manga details)
- `GET /api/titles/{hid}/chapters?lang=en` → `{items:[...]}` (chapter list; omit `lang` to get all languages as a fallback when a title has no English chapters)
- `GET /api/chapters/{chapterId}` → `{data:{pages:[{url}]}}` (chapter + page image URLs, used directly with no CDN rewriting)

`hid` (MangaFire's short opaque id, e.g. `dkw` for One Piece) is used as the manga id. Chapter ids are MangaFire's numeric chapter row ids. CDN image URLs (`m3z.mfcdn3.xyz`, `static.mfcdn.nl`) load with no Referer required.

**Why:** Scraping HTML for a client-rendered SPA is fundamentally broken (no server-rendered data to extract), and the WebView/Cloudflare-bypass machinery this source used to need is unnecessary once the underlying JSON API is used directly — it isn't behind Cloudflare's JS challenge.

**How to apply:** When re-touching MangaFire, always hit `/api/*` as JSON, never scrape `mangafire.to` HTML pages. `requiresVerification: false` — do not register it in `GlobalWebViewBridge`'s CF-protected source list.
