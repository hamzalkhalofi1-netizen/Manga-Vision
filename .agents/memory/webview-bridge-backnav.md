---
name: WebView bridge back-navigation race condition
description: processNext() immediately navigated back to baseUrl when queue emptied, causing AJAX calls that followed fetchRendered to run with wrong Referer (baseUrl instead of reader page URL).
---

## The rule
`processNext` must use a **400 ms debounced timer** for back-navigation, not an immediate `setUris(baseUrl)` call.

**Why:** When `fetchRendered` resolves, `processNext` is called with an empty queue. The following AJAX `fetch()` call arrives as a JS microtask — before the React re-render, but after the synchronous code in `processNext`. The 60 ms `setTimeout` used for script injection fires AFTER the React re-render, so if back-navigation is immediate the WebView is already navigating to baseUrl when the AJAX script runs, giving it the wrong Referer (`mangafire.to/` instead of the reader page URL). MangaFire's `/ajax/read/{token}/chapter/en` returns 403 when Referer ≠ reader page URL.

**How to apply:**
- In `SourceMutable`, keep `navigateBackTimer: ReturnType<typeof setTimeout> | null`
- When queue empties and `currentUri !== baseUrl`: start a 400 ms timer; only actually navigate if queue is still empty and not processing when it fires
- When a new request arrives in `processNext`: `clearTimeout(navigateBackTimer); navigateBackTimer = null`
- 400 ms covers: React re-render cadence (≤16 ms) + injection setTimeout (60 ms) + microtask→macrotask hand-off + real-device jitter

**File:** `artifacts/mobile/components/GlobalWebViewBridge.tsx` — `processNext` callback, `navigateBackTimer` field in `SourceMutable`.
