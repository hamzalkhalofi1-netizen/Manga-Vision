---
name: Expo startup env vars
description: Which env vars are safe to use in start.sh and which break Metro on Replit
---

## The rule

`start.sh` must NOT set `CI=1` and must NOT set `EXPO_UNSTABLE_HEADLESS=1`.

**Why:**
- `CI=1` — Metro enters "CI mode": hot reload disabled, QR code suppressed, exp:// URL not printed
- `EXPO_UNSTABLE_HEADLESS=1` — makes `envIsHeadless()` return true inside `@expo/cli`, which sets `enableStandaloneFuseboxShell=false` (good — stops the libglib crash) BUT ALSO hides the QR code and exp:// URL in Metro output (bad)

**How to apply:**
- Safe to use: `EXPO_NO_DEVTOOLS=1`, `BROWSER=none`, `EXPO_NO_UPGRADE_CHECK=1`
- Never add: `CI=1`, `EXPO_UNSTABLE_HEADLESS=1`
- The xdg-open/libglib DevTools error is cosmetic on Replit Ubuntu 24.04; Metro keeps running

## The libglib DevTools error

```
ERROR  An unknown error occurred while installing React Native DevTools. Details:
react-native-devtools: error while loading shared libraries: libglib-2.0.so.0
```

This comes from `@react-native/debugger-shell` (part of RN 0.81+ DevTools). The binary requires `libglib-2.0.so.0` which is absent on Replit's Ubuntu 24.04 container. It appears on every startup but is **non-fatal** — Metro, hot reload, QR code, and exp:// URL all work normally.

`EXPO_NO_DEVTOOLS=1` does not suppress this error (not a recognized Expo env var as of SDK 56), but is harmless to keep.

## Working startup sequence

1. Remove `--go` and `--web` from the `expo start` invocation — those call xdg-open which crashes immediately on headless servers
2. Do not set `CI=1` — it breaks hot reload
3. Do not set `EXPO_UNSTABLE_HEADLESS=1` — it hides the exp:// URL
4. `EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN` (injected by the MangaVerse workflow) gives `exp://xxx.expo.picard.replit.dev` — a real internet-accessible URL for Expo Go over 4G
