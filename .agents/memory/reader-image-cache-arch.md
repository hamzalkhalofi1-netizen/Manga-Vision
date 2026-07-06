---
name: Reader image cache architecture
description: How progressive chapter image loading + disk LRU caching is wired between ReaderPreloader and MangaPage in artifacts/mobile
---

`ImageDiskCache` (services/cache/ImageDiskCache.ts) is the single source of
truth for page image bytes — it downloads via `expo-file-system/legacy`
`createDownloadResumable` straight to disk (no base64/JS-string round trip),
tracks a `lastAccessed` LRU index, and enforces a configurable byte budget
(default 3GB, meant to be tunable in the 2-5GB range) by evicting the
least-recently-used files first.

Both `ReaderPreloader` (ahead/behind prefetch window) and `MangaPage`
(via the `useCachedPageImage` hook, for the currently-visible page) read and
write through this same cache instance rather than having independent
download paths.

**Why:** a single global concurrency semaphore lives inside
`ImageDiskCache.download()`. If preloading and on-screen loading used
separate queues/limits, the "3-5 concurrent downloads" requirement would be
violated whenever both fired at once, and there was a real risk of
downloading the same page twice (once for preload, once for display).
`ImageDiskCache.download()` also de-dupes concurrent requests for the same
URL via an in-flight promise map, so this is safe even without coordination
between the two callers.

**How to apply:** if you add another consumer of chapter page images (e.g. a
thumbnail strip or export feature), route it through `ImageDiskCache`
(`getPath` for cache-first reads, `download` for cache-miss fetches) instead
of calling `expo-image`'s prefetch or `fetch` directly — otherwise it bypasses
the shared concurrency limit and LRU accounting.
