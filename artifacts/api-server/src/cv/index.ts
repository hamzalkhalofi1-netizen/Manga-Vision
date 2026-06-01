/**
 * OpenCV singleton for Node.js.
 *
 * @techstark/opencv-js is a CommonJS module that embeds and loads its WASM
 * bundle synchronously during `require()`.  Dynamic `import()` of CJS modules
 * in Node.js ESM context can stall because the module's internal WASM init
 * callback is never fired.  We use `createRequire` for a reliable synchronous
 * load and pre-warm the instance on module import so the first request has
 * zero additional startup latency.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Resolve require relative to this file so it finds node_modules correctly
// whether running from dist/ (compiled) or src/ (ts-node / dev).
const _req = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

let _cv: CV | null = null;

export function getCV(): CV {
  if (_cv) return _cv;
  _cv = _req("@techstark/opencv-js");
  return _cv;
}

// Pre-warm: evaluate the CJS module (and its embedded WASM) at import time
// so Mat / inpaint / etc. are ready on the first incoming request.
getCV();
