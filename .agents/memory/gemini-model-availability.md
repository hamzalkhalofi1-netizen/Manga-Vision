---
name: Gemini model availability
description: Gemini API model-list results may disagree with actual generateContent availability for a test key
---

The rule: Treat a successful `models.list` entry as provisional. Before selecting a Gemini model for the app, verify the exact `generateContent` endpoint and request shape with the intended key; a listed model can still return 404 or 400.

**Why:** The test key listed `gemini-2.5-flash-lite`, but a real image request returned 404. The stable `gemini-flash-lite-latest` alias accepted the image request with HTTP 200. The current workspace has no managed Gemini credential, so the mobile app's user Settings key is the intended credential for live localization.

**How to apply:** Keep model selection narrow, test one real request using the intended credential, and report model availability separately from missing credentials, image acquisition, quota, and response parsing failures.