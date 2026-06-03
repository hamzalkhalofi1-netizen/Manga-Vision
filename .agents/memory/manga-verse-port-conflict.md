---
name: MangaVerse port conflict with artifact expo workflow
description: Artifact workflow grabs port 5001 before start.sh; how to handle gracefully
---

**Rule:** In `start.sh`, check if port `$EXPO_DEV_PORT` is already in use BEFORE killing processes. If it is, skip Metro start entirely and only run the proxy. Never kill blindly and restart — the Replit artifact workflow (`artifacts/mobile: expo`) auto-restarts Expo and wins the race.

**Why:** The `artifacts/mobile: expo` workflow starts automatically on port 5001. When `MangaVerse` starts, its old `start.sh` killed everything then tried to start Expo on 5001 again. The artifact workflow would restart, Metro saw the port taken, prompted "Use 5002 instead?", script hung (no stdin in Replit), and MangaVerse showed "FINISHED".

**How to apply:**
```bash
if lsof -ti tcp:"$EXPO_DEV_PORT" >/dev/null 2>&1; then
  EXPO_ALREADY_RUNNING=true  # proxy-only mode
else
  EXPO_ALREADY_RUNNING=false  # kill + start Metro ourselves
fi
```
Proxy on port 5000 routes `/api/*` → 3000 and `*` → 5001 regardless of who started Expo.
