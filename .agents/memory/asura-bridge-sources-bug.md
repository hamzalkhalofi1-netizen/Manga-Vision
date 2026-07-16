---
name: Asura WebView bridge source bug
description: Asura was incorrectly listed in BRIDGE_SOURCES causing a hidden WebView to load asurascans.com, saturating the network and interrupting the JS thread every 1.5 s.
---

# Rule
Never add a source to `BRIDGE_SOURCES` in `GlobalWebViewBridge.tsx` unless it explicitly calls `webViewBridge.fetch()` or `webViewBridge.fetchRendered()` in its adapter. Adapters with `requiresVerification = false` must NOT be listed.

**Why:** Each entry in `BRIDGE_SOURCES` creates a persistent hidden WebView that:
1. Loads the source's full homepage on startup (heavy network + CPU)
2. Runs `SESSION_JS` — a `setInterval(report, 1500)` that fires `postMessage` every 1.5 s indefinitely, interrupting the RN JS thread
3. Triggers `handleLoadEnd` on every page load → `setSourceStatus` called **twice** (once in `handleLoadEnd`, once in `processNext`) → two `BridgeContext` re-renders even when status is already "idle"

The AsuraAdapter (`services/sources/asura/index.ts`) uses `EngineHttpClient` for direct HTTP and has `requiresVerification = false`. The WebView bridge is completely unused by it. Keeping asura in `BRIDGE_SOURCES` caused severe app-wide slowness, multi-second back-navigation latency, scrolling lag, and apparent network loss when browsing the Asura source.

**How to apply:** Before adding any new source to `BRIDGE_SOURCES`, confirm that it calls `webViewBridge.fetch()` or `webViewBridge.fetchRendered()` at least once in its adapter code. If it only uses `EngineHttpClient` or legacy `fetchClient`, it must not be listed.

# Secondary fix applied
`setSourceStatus` in `GlobalWebViewBridge` now guards against no-op status updates:
```js
if (webViewBridge.getStatus(sid) === status) return;
webViewBridge.setStatus(sid, status);
setStatuses((prev) => (prev[sid] === status ? prev : { ...prev, [sid]: status }));
```
This prevents the double re-render when `handleLoadEnd` → `processNext` both try to set "idle" for the same source in the same tick. Apply this pattern to any similar service-status bridge component.
