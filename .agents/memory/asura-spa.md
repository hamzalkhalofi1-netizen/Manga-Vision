---
name: Asura SPA limitation
description: asuracomic.net is a pure client-side SPA; scraping individual manga/chapter pages is impossible
---

## Discovery (confirmed May 2026)
asuracomic.net uses Astro v5 in SPA mode. Every URL (including `/comics/slug`, `/series/slug`, `/api/...`) returns the same 594,781-byte HTML shell with:
```html
<h1 class="sr-only">Read Free Manga, Manhwa & Manhua Online - Asura Scans</h1>
```

## What DOES work (server-side)
- `/series` listing page: SSR, returns 45 manga cards per page with title, cover, slug, `series_id`
- `extractMangasFromAstroHtml` Strategy 1 (rendered HTML cards) reliably gets 45 items
- Slugs use pattern: `{manga-name}-7b57f74d` where the hex suffix is the SAME for all manga on that page (Astro component hash, not manga-specific ID)

## What does NOT work (SPA)
- `/comics/{slug}` — returns listing shell, not manga detail
- `/series/{slug}` — same
- All API path attempts return HTML shell
- `api.asuracomic.net` — connection refused (no separate API subdomain)
- `TrendingSection.js` etc. Astro component JS files are only 167 bytes (stubs/redirects)

## Detection
```js
function isSpaShell(html) {
  return /<h1[^>]*class="[^"]*sr-only[^"]*"[^>]*>\s*Read Free Manga/i.test(html) ||
    /Read Manga, Manhwa &amp; Manhua Online - Asura Scans/i.test(html);
}
```

**Why:** Asura switched to full client-side rendering. Manga detail pages and chapter lists are rendered via JavaScript after the page loads, not in the server response.

**How to apply:** Use `isSpaShell()` detection in `getChapters` and `getChapterPages` to throw a clear `SourceError("auth")` instead of silently returning 0 results.
