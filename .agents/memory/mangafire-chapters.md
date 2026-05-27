---
name: MangaFire chapter structure (2025)
description: Confirmed AJAX response format for chapters and image-loading flow
---

## Chapter list AJAX endpoint
`GET /ajax/manga/{mfId}/chapter/en` where `mfId` is the suffix of the full slug (e.g. slug `berserk.m2vv` → mfId `m2vv`).

Response: `{"status":200,"result":"<ul class=\"scroll-sm\">..."}` — result is an HTML string.

HTML structure (confirmed 2025):
```html
<li class="item" data-number="104">
  <a href="/read/slug/en/chapter-104" title="Vol N - Chap N">
    <span>Chapter 104: Title</span>
    <span>May 02, 2025</span>
  </a>
</li>
```

Key: `data-number` (NOT `data-id`), href uses `/read/slug/en/chapter-N` (NOT `/en/full/`).
Chapter ID stored as the full reader path `/read/slug/en/chapter-104`.

## Chapter image flow
1. Fetch reader page at `/read/slug/en/chapter-N` — extract `data-a="token"` attribute
2. Token is session-wide (same for all chapters, e.g. `af266caa520a`) — NOT chapter-specific
3. AJAX endpoint `/ajax/read/{token}/chapter/en` requires BOTH correct Referer AND cf_clearance
4. Without both: returns `{"status":403,"message":"Request is invalid."}`

**Server proxy path (web):** Always returns 403 — proxy has no cf_clearance cookies. This is a fundamental limitation of the web platform for MangaFire.

**Native path (correct fix):** `webViewBridge.fetchRendered("mangafire", fullReaderUrl, 7000)` — navigates the persistent WebView to the reader page (has cf_clearance), waits 7s for MangaFire's React reader to execute and render `<img>` elements, then extracts images from the fully-rendered DOM via `parseChapterImagesFromHtml`.

**Referer requirement:** The AJAX endpoint determines which chapter to serve via the `Referer` header. The reader page URL (not site root) must be the Referer. On web this is sent via `x-proxy-referer` header to the server proxy, but the request still fails without cf_clearance.

**Why:** MangaFire uses Cloudflare + a JS-computed session token. Server-side requests lack cf_clearance. The WebView naturally accumulates cf_clearance after first verification.

**How to apply:** Chapter listing (AJAX `data-number` parsing) works without auth. Image loading on native uses fetchRendered(7s). On web, show "requires verification" error.
