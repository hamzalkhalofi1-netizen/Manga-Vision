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
2. Call AJAX `/ajax/read/{token}/chapter/en` — needs browser session cookies (cf_clearance)
3. Response format when it works: `{"status":200,"result":{"images":[["url",w,h],...]}}`
4. Without browser session: returns 403 "Request is invalid"

**Why:** MangaFire uses Cloudflare and a JS-computed session token. Server-side requests lack the cf_clearance cookie needed to authenticate the AJAX image endpoint.

**How to apply:** Chapter listing works without auth. Image loading requires user to go through browser verification (sets cf_clearance cookie in sessionStore).
