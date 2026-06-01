---
name: CV pipeline OpenCV loading
description: How to correctly load @techstark/opencv-js in the compiled ESM API server
---

## Rule
Never use `await import('@techstark/opencv-js')` in the compiled ESM bundle.  Use `createRequire` for a synchronous CJS load and pre-warm the instance on module import.

```typescript
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let _cv: any = null;
export function getCV(): any {
  if (_cv) return _cv;
  _cv = _req("@techstark/opencv-js");
  return _cv;
}
getCV(); // pre-warm
```

**Why:** Dynamic `import()` of CJS modules in Node.js ESM context can stall because the WASM runtime's `onRuntimeInitialized` callback is never triggered. The `require()` path loads WASM synchronously and the cv object is fully usable immediately.  Verified: `new cv.Mat(...)`, `cv.inpaint()`, `cv.findContours()` all work synchronously after `require()` returns.

**How to apply:** Any server-side code that needs OpenCV must call the synchronous `getCV()` (no await) from `src/cv/index.ts`.  Add `@techstark/opencv-js` to the `external` array in `build.mjs` so esbuild does not attempt to bundle the WASM binary.
