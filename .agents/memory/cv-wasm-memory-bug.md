---
name: CV Pipeline WASM Memory Bug
description: Critical OpenCV.js WASM heap use-after-free bug affecting SegmentationEngine, InpaintingEngine, DebugRenderer
---

# WASM Heap Use-After-Free in OpenCV.js

## The Rule
After calling `mat.delete()` (which frees WASM heap memory), any `Buffer` or `Uint8Array` that was created as a zero-copy view into that memory (`Buffer.from(mat.data.buffer, byteOffset, length)`) becomes a view into freed/reused memory — reads return zeros or garbage.

**Fix**: Always copy before deleting:
```typescript
const buf = Buffer.from(mat.data); // copies into Node.js heap
mat.delete();                       // now safe to free WASM memory
```

## Why
`mat.data` returns a `Uint8Array` view directly into WASM linear memory. `Buffer.from(uint8array.buffer, byteOffset, length)` creates a zero-copy view into that same WASM buffer. When `mat.delete()` is called, WASM frees that memory region. Any subsequent read of the Buffer returns zeros (or garbage on heap reuse). The bug is silent — no exception thrown.

## How to Apply
Every place you call `mat.delete()`, ensure any Buffer/Uint8Array referencing `mat.data` was created with `Buffer.from(mat.data)` (copy constructor), not `Buffer.from(mat.data.buffer, ...)` (view constructor). Applies to SegmentationEngine, InpaintingEngine, DebugRenderer, and any future CV code.

## Symptom Pattern
- Segmentation/inpainting runs (timing > 0) but produces no visual output
- Debug stage images show tiling artifact (S3/S4/S5 shows page repeated in grid)
- Mask is all-zeros despite correct OpenCV operations
- inpainted region count > 0 but text still visible in S6
