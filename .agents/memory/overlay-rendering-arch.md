---
name: Overlay rendering architecture
description: Key decisions for the manga translation overlay renderer — mask vs. layout geometry split, feather system, font sizing.
---

## The core insight: two separate geometry layers

The Gemini OCR polygon is **glyph-tight** — it wraps only the original text characters, NOT the full speech bubble. This caused the "subtitle appearance" bug: text was sized to the narrow glyph polygon instead of the full bubble.

**Fix:** Two separate geometry layers in `SkiaOverlayCanvas.tsx`:

| Layer | Geometry | Purpose |
|---|---|---|
| Mask (SVG) | Original OCR polygon + expand | Cover original ink precisely |
| Text layout (View) | OCR polygon × `BUBBLE_LAYOUT_SCALE` | Fill the estimated bubble area |

`BUBBLE_LAYOUT_SCALE = 1.35` — manga speech bubbles are roughly 1.3–1.5× the text column area.

**Why:** Sizing the text container to the glyph polygon caused narrow columns centered in the page — subtitle appearance. Sizing to the estimated bubble gives natural scanlation layout.

**How to apply:** Never use `glyphW × glyphH` for the text container. Always use `layoutW = ocrW * BUBBLE_LAYOUT_SCALE` and `layoutH = ocrH * BUBBLE_LAYOUT_SCALE`.

---

## Three-layer soft mask system

```
Halo  (polygon + haloExpand px)  fill 10% opacity + faint stroke  → outer soft glow
Mid   (polygon + midExpand px)   fill 42% opacity + light stroke  → feather zone
Core  (polygon + 4px)            fill 100% opacity               → covers original ink
```

`haloExpand = max(5, min(11, ocrW * 0.08))` — scales proportionally with region size.

All three layers use the same `bgColor` hue — only opacity changes, creating a natural gradient into the bubble background.

Render order: ALL halos first, then ALL mids, then ALL cores — using separate `map()` passes. This prevents halo-of-A from overlapping core-of-B.

---

## Font sizing

- Safe zone: **91%** of `layoutW × layoutH` (was 88% of `ocrW × ocrH` — too conservative, caused 10–12px subtitle fonts)
- Dialogue ladder: `[24, 22, 20, 18, 16, 14, 12, 10]` (was 22 max)
- SFX ladder: `[30, 28, 26, 24, 22, 20, 18, 16]` (was 26 max)
- Native measurement heuristic: `text.length × fontSize × 0.47` — intentionally slight over-estimate for size selection; actual wrapping done by React Native

---

## What NOT to change

- `translationQueue.ts`, `inpaintClient.ts`, `translate-image.ts` (API prompt) — off limits
- `MangaPage.tsx` — entry point, stable interface
- `TextRegion` interface — all data flows from here
- `pointerEvents` must be in `style` prop (not View prop) — deprecation warning otherwise
