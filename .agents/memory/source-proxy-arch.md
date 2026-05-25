---
name: Source Proxy Architecture
description: When to use directOnWeb vs server proxy for manga sources; Replit server IP limitations
---

## Rule
APIs with CORS headers (ComicK `api.comick.io`, MANGA Plus) must use `directOnWeb: true` in `proxiedFetch`. HTML-scraping or CF-protected sources (MangaFire, Asura) always route through the server proxy.

**Why:** Replit's server IP is flagged by Cloudflare for APIs like ComicK, causing 403/challenge responses. MANGA Plus `api.mangaplus.shueisha.co.jp` fails DNS resolution from Replit's server entirely. Both work fine via direct browser fetch because the user's real IP and browser UA aren't flagged.

**How to apply:** When adding a new source, check if its API has `Access-Control-Allow-Origin: *`. If yes, add `directOnWeb: true` to its `proxiedFetch` calls. If it requires HTML scraping or has aggressive bot protection, use server proxy (default, no flag needed).

## Key files
- `services/sources/fetchClient.ts` — `ProxiedFetchOptions.directOnWeb`
- `services/sources/comick.ts` — uses `directOnWeb: true`
- `services/sources/mangaplus.ts` — uses `directOnWeb: true`
- `api-server/src/routes/source-proxy.ts` — Express 5 regex route
