---
name: _inFlight AbortError propagation (ImageDiskCache + useCachedPageImage)
description: Root cause of MangaFire reader flickering — preloader abort signals propagate to useCachedPageImage via shared _inFlight promises
---

## The Bug

`ImageDiskCache._inFlight` de-duplicates concurrent downloads of the same URL:
- ReaderPreloader downloads WITH an `AbortSignal` (so it can cancel on chapter change)
- `useCachedPageImage` joins the same promise via `_inFlight.get(url)` — with NO signal
- When the preloader aborts (chapter change, enabled→false, pages array reference change), the AbortError propagates to `useCachedPageImage`, which then sets `status="error"`, hiding the image

**Why:** `ImageDiskCache.download` signature: `(url, headers, signal?)`. Promise is shared across callers. There is no way for a caller to "own" the promise once it joins via `_inFlight`.

## The Fix

Added `forceIndependent=true` parameter to `ImageDiskCache.download`:
- When `forceIndependent=true`, skips BOTH `_inFlight.get()` AND `_inFlight.set()` — starts a completely independent download that no one can abort
- `useCachedPageImage` uses `forceIndependent=true` in all AbortError retry paths (slow-path and background verify)

## Co-bugs Fixed in Same Session

1. **Background verify `setStatus("loading")` hides image**: Background verify was calling `setStatus("loading")` when file evicted, which caused `imageNotReady=true` → `Image` component unmounts. Fix: keep `status="ready"` and old `localUri` visible during silent re-download; only swap `localUri` when new file confirmed. If re-download fails, stay visible (non-fatal).

2. **`setNativeDims` creates new object every render**: `setNativeDims({ w, h })` always creates a new object reference → unnecessary re-renders. Fix: functional update with equality check.

3. **`rawImageSource`/`imageSource` not memoized**: New objects created on every render. Fix: wrap in `useMemo`.

**How to apply:** Any future change that adds a new "caller" to `ImageDiskCache.download` should check if that caller can share abort signals with other callers. If not, use `forceIndependent=true`.
