---
name: natomanga.com migration
description: chapmanganato.to and manganato.com squatted; natomanga.com is the live successor with new URL structure
---

chapmanganato.to → domain-squatted (spinzywheel.com). As of 2026, kakalot/manganato adapters target https://www.natomanga.com.

**URL structure changes (old → new):**
- Popular: `/genre-all?type=topview` → `/genre/all?type=topview&state=all&page=N`
- Latest: `/genre-all?type=newest` → `/genre/all?type=latest&state=all&page=N`
- Search: `/search/story/{underscore_query}` → `/search/story/{hyphen-query}` (spaces→hyphens now)
- Manga detail: `/{manga-xxx}` → `/manga/{slug}` (no `manga-` prefix in slug)
- Chapter: `/{manga-xxx}/{chapter-N}` → `/manga/{slug}/chapter-{N}`

**ID format changes:**
- Old: `manga-ud484` (slug with `manga-` prefix)
- New: `emperor-of-solo-play` (plain slug, no `manga-` prefix)
- Chapter ID: `emperor-of-solo-play/chapter-1`

**Chapter list:** AJAX-only on natomanga.com. Detail page shows only "Start Reading" (first) and "Newest Chapter" (last) links. Adapter synthesises full list by generating integers from max down to min.

**Chapter images:** In `var chapterImages = [...]` JS array (relative paths like `slug/1/0.webp`), AND in `<div class="container-chapter-reader">` img tags. CDN primary: `img-r1.2xstorage.com`, fallback: `imgs-2.2xstorage.com`. No hotlink enforcement (200 without Referer).

**Why:** Domain was squatted; content migrated to natomanga.com with an updated site template.

**How to apply:** Any future changes to kakalot.ts/manganato.ts/kakalotParser.ts must target natomanga.com URLs.
