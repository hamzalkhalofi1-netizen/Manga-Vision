---
name: WebView bridge architecture
description: Mihon-grade source networking — persistent hidden WebViews per CF source, all requests routed through them on native
---

## Architecture

`services/webViewBridge.ts` — singleton EventEmitter. Source adapters call `.fetch()` / `.fetchRendered()` which return Promises. GlobalWebViewBridge React component fulfills them via injected JS.

`components/GlobalWebViewBridge.tsx` — mounted ONCE in `_layout.tsx` inside KeyboardProvider. Has one persistent hidden WebView per CF source (mangafire + asura). WebViews NEVER unmount — they accumulate `cf_clearance` across the entire app session. Exported: `BridgeContext`, `useBridgeStatus`.

`components/SourceStatusBanner.tsx` — slides in when bridge status is `cf_challenge`. Calls `BridgeContext.showVerification(sourceId)` to reveal the persistent WebView. No popup — same WebView becomes visible.

## Source adapter patterns

- **MangaFire AJAX** (`mfXhrFetch`): On native, calls `webViewBridge.fetch("mangafire", url, { headers: { "X-Requested-With": "XMLHttpRequest" } })`. The WebView makes the XHR with cf_clearance in its cookie store. On web: uses `proxiedFetch` (server-side proxy).
- **Asura SPA** (`asuraFetch`): On native, calls `webViewBridge.fetchRendered("asura", url, 3000)` — navigates WebView to URL, waits 3s for SPA JS to render, extracts `document.documentElement.outerHTML`. On web: uses `proxiedFetch`.

## Mutable state pattern

Per-source mutable state lives in a `useRef<Record<string, SourceMutable>>` (not React state) to avoid re-renders on every queue mutation. React state only for: status, visibility, URI (things that need to drive rendering).

## CF challenge flow

1. SESSION_JS (injected via `injectedJavaScript` prop, polls every 1.5s) reports `isCF: true`
2. Bridge sets status to `cf_challenge`, pauses queue processing
3. SourceStatusBanner animates in from top of screen
4. User taps "Verify" → `showVerification(sourceId)` → WebView becomes visible
5. User solves CF → SESSION_JS reports `isCF: false, hasCFClearance: true`
6. Bridge saves non-HttpOnly cookies to sessionStore, sets status "verified", resumes queue
7. In-flight request is rejected (caller retries); queued requests process normally

## Why: no more popup loops

Old: each verification opened a new throwaway WebView (no cookie persistence). New: the WebView has lived since app launch — if cf_clearance is still valid, all requests succeed silently with zero user interaction. The banner only appears when CF genuinely expires.

## pointerEvents

Use `style={{ pointerEvents: ... }}` not the `pointerEvents` prop on View (deprecated in newer RN).

## File locations

- `services/webViewBridge.ts` — bridge singleton
- `components/GlobalWebViewBridge.tsx` — persistent WebViews, BridgeContext, useBridgeStatus
- `components/SourceStatusBanner.tsx` — CF banner UI
- `app/_layout.tsx` — GlobalWebViewBridge wraps RootLayoutNav inside KeyboardProvider
