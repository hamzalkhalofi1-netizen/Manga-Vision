---
name: Expo build port collision
description: Port ownership needed when validating the imported Expo app and mockup sandbox
---

The static Expo build script starts Metro on port 8081, while the mockup sandbox also uses port 8081 during development.

**Why:** Running both at once makes the Expo build enter a non-interactive “use another port?” prompt and fail instead of producing bundles.

**How to apply:** Stop the mockup sandbox before running the mobile static build, then restart it after the build completes. Keep the MangaVerse proxy workflow as the preview owner on port 5000.