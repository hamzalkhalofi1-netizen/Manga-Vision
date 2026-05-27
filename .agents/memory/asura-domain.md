---
name: Asura Scans domain and rendering architecture
description: Domain history, proxy strategy, and why web listing works via redirect
---

## Domain history
- 2023/2024: `asurascans.com` → moved to → `asuracomic.net`
- 2025/2026: `asuracomic.net` → 301 redirect → `asurascans.com` (current live domain)

## Proxy URL: keep asuracomic.net (intentional)
The **server proxy** uses `"asura": "https://asuracomic.net"`.

**Why:** asuracomic.net 301-redirects ALL paths to `asurascans.com/` (the home page). The home page has SSR-rendered manga cards that `extractMangasFromAstroHtml` Strategy 1 can parse (~42 items). Direct `asurascans.com/series?page=1` returns a pure client-side Astro shell (no SSR cards).

The **mobile source adapter** `SITE_URL = "https://asurascans.com"` for native WebView direct navigation.

## Web vs. Native split
- **Web (proxy):** Listing works (42 items from home page redirect). Detail/chapters fail — any `/series/{slug}` path gets the home page which `isSpaShell()` correctly detects.
- **Native (WebView):** `fetchRendered("asura", url, 7000)` — WebView navigates to `asurascans.com` directly, Astro islands hydrate after ~7s, full manga data available.

## isSpaShell detection (confirmed patterns)
```js
/Read Manga, Manhwa &(?:amp;)?\s*Manhua Online.*Asura Scans/i  // home page
/<h1[^>]*class="[^"]*sr-only[^"]*"[^>]*>\s*Read Free Manga/i   // old shell marker
/Page Not Found\s*\|\s*Asura Scans/i                           // 404 page
```

**How to apply:** Never change proxy to `asurascans.com` directly — that breaks web listing. Keep proxy on `asuracomic.net`. Native path always uses `asurascans.com` directly.
