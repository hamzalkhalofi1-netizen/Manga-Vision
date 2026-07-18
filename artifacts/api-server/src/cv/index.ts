/**
 * OpenCV singleton for Node.js.
 *
 * @techstark/opencv-js is a CommonJS module that embeds and loads its WASM
 * bundle synchronously during `require()`.  Dynamic `import()` of CJS modules
 * in Node.js ESM context can stall because the module's internal WASM init
 * callback is never fired.  We use `createRequire` for a reliable synchronous
 * load and pre-warm the instance on module import so the first request has
 * zero additional startup latency.
 *
 * If the package is not installed (e.g. the environment was reset), the module
 * returns null gracefully instead of crashing the entire server at startup.
 * Routes that depend on OpenCV must check getCV() !== null before using it.
 */

import { createRequire } from "node:module";

// Resolve require relative to this file so it finds node_modules correctly
// whether running from dist/ (compiled) or src/ (ts-node / dev).
const _req = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

let _cv: CV | null = null;
let _attempted = false;

export function getCV(): CV | null {
  if (_attempted) return _cv;
  _attempted = true;
  try {
    _cv = _req("@techstark/opencv-js");
  } catch {
    _cv = null;
  }
  return _cv;
}

// Pre-warm silently: if the package is available, load it now so the first
// request has zero startup latency. If it is missing, the server continues
// to start normally and cv-dependent routes respond with 503.
getCV();
