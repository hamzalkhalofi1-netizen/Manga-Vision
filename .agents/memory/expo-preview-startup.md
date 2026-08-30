---
name: Expo preview startup
description: Preview behavior while the Expo Metro server is still booting
---

The public preview proxy must treat a temporarily unavailable Metro upstream as a recoverable startup state, not as a terminal blank-page error.

**Why:** Metro can take several seconds to bind its port after the proxy is ready. A single 502 response can remain stuck in the Replit preview even after Metro becomes healthy.

**How to apply:** Keep the preview response visibly branded and retry automatically during Metro startup; preserve normal API error responses separately.