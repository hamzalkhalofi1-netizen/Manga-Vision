---
name: Translation image source handoff
description: The translation request must consume the exact image URI resolved by the reader on both native and web
---

**Rule:** Pass the reader's resolved image URI through `TranslationOptions.localImageUri` and use it directly for byte acquisition. Do not rebuild a CDN fetch when the reader already has a native cache file or web proxy URI.

**Why:** The reader can display a hotlink-protected image successfully while a second JavaScript request to the original CDN URL fails, especially on Android and in browser proxy flows.

**How to apply:** Keep the reader callback/ref as the source of truth. On native read that URI with Expo FileSystem; on web fetch the exact rendered proxy URI. Only use the original URL as a fallback when no reader-resolved URI exists.