---
name: Native CV pipeline URL fix
description: runCVPipelineWithRetry uses relative /api which fails on native APK
---

**Rule:** In `MangaPage.tsx`, compute `apiBase` based on `Platform.OS` before calling `runCVPipelineWithRetry`. On native pass `EXPO_PUBLIC_API_URL + "/api"`. On web pass `"/api"`.

**Why:** The default `apiBase = "/api"` in `InpaintingEngine.ts` is a relative URL. Relative URLs work in a web browser (resolved against the current origin) but fail silently on native (React Native fetch doesn't have an origin to resolve against). The result is the CV pipeline always throws, always falls back to SkiaOverlayCanvas — the inferior overlay path.

**How to apply:**
```typescript
import { Platform } from "react-native";
const apiBase =
  Platform.OS === "web"
    ? "/api"
    : `${process.env.EXPO_PUBLIC_API_URL ?? ""}`.replace(/\/$/, "") + "/api";
runCVPipelineWithRetry(uri, cvRegions, apiBase);
```
`EXPO_PUBLIC_API_URL` is set in `start.sh` from `$REPLIT_DEV_DOMAIN` and inlined at bundle time by Expo.
