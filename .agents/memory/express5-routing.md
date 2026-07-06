---
name: Express 5 wildcard routing
description: Express 5 does not support string wildcard routes like /:id/* — must use regex
---

## Rule
Express 5 removed string wildcard (`*`) support. Use a regex route for catch-all params.

**Why:** `router.use("/:sourceId/*", ...)` throws in Express 5. Only regex patterns work for multi-segment wildcards.

**How to apply:**
```typescript
// Express 5 — use regex
router.get(/^\/source-proxy\/([^/]+)(?:\/(.*))?$/, async (req, res) => {
  const sourceId = req.params[0];
  const path     = req.params[1] ?? "";
  // ...
});
```

## Debugging false "route doesn't work" reports
If a route that looks syntactically correct (verified by testing the regex/handler in isolation) still 404s in the running app, restart the server workflow before concluding the route is broken. The dev script rebuilds (`pnpm run build && pnpm run start`) but a long-lived process from before a `pnpm install`/dependency bump can keep serving a stale bundle — always eliminate "stale running process" before debugging route-matching logic further.
