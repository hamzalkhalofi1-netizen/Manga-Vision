---
name: manganelo adapter → mangagg.com
description: manganelo source adapter was redirected to mangagg.com (WP-Manga) after readmanganelo.com died
---

`readmanganelo.com` → ENOTFOUND (DNS dead). The `manganelo` source adapter (id="manganelo") now targets `mangagg.com`.

- proxyId: `"mangagg"` → `https://mangagg.com`
- Image CDN: `s4.mangagg.com` (proxyId: `"mangagg-cdn"`)
- Class: `MangaggAdapter extends BaseAdapter` in `manganelo.ts`
- Referer for images: `https://mangagg.com/`
- Chapter list: synthetic (AJAX on mangagg too); inline HTML shows first+last chapter only

**Why:** readmanganelo.com died; mangagg.com hosts similar WP-Manga content and is live.
