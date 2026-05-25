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
