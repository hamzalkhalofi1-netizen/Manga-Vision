---
name: Manga overlay rendering
description: Key rules for the scanlation-quality text overlay system in MangaVerse
---

## Polygon-anchored architecture (single source of truth)

The OCR polygon is the single source of truth for mask shape, text anchor, font sizing, and text rotation. Never derive positioning from bbox center or translated text dimensions.

- **Centroid**: computed server-side via Shoelace formula, sent as `centroid: {x,y}` (normalized). Client-side Shoelace fallback if absent.
- **Rotation**: server-side from top-edge angle of polygon, clamped ±30°, sent as `rotation` (degrees). Client-side fallback from `polygonRotationDeg()`.
- **Mask shape**: SVG `<Polygon>` (not `<Rect>`) — vertices expanded outward from centroid by `MASK_EXPAND=3px`.
- **Font sizing**: `polygonDimensions()` measures along polygon's own axes (handles rotated text correctly — axis-aligned bbox would over-estimate one dimension).
- **Text rotation**: React Native `transform: [{ rotate }]` applied to text view centered on centroid — rotates exactly around centroid with no additional translate.

**Why:** `(minX+maxX)/2` bbox center is inaccurate for skewed polygons; `<Rect>` mask ignores polygon shape; axis-aligned bbox over-estimates dimensions for rotated text.

**How to apply:** `getPlacement()` in `SkiaOverlayCanvas.tsx` always uses polygon centroid + rotation + `polygonDimensions()`. Server's `translate-image.ts` computes `centroid` and `rotation` after polygon validation.

## The mask must cover the ORIGINAL text area, not the translated glyph bounds

**Why:** The OCR polygon is the bounds of the *source* text (e.g., English). If the Arabic translation is shorter/narrower, a glyph-tight mask leaves the original text visible around the edges. Mask size = OCR bbox + 3px expansion at 100% opacity.

**How to apply:** In `SkiaOverlayCanvas.tsx`, `maskLeft/Top/W/H` are derived from `ocrW/ocrH` (the OCR bbox), not `glyphBounds(typeset)`. The text view stays glyph-sized and centered on the OCR center.

## Native Arabic heuristic: 0.47, not 0.55

**Why:** Arabic connected script (with kashida, ligatures) renders significantly shorter than 0.55×chars×fontSize. The 0.55 value over-estimated by ~15–20%, causing the font cascade to drop 2–3 steps and produce 10–12px "subtitle-sized" text. 0.47 is empirically accurate for Noto Naskh Arabic Bold.

**How to apply:** In `ArabicTypesettingEngine.ts`, the fallback path returns `text.length * fontSize * 0.47`.

## Safe zone: 88% of OCR dims, not 82%

**Why:** The OCR polygon from Gemini is glyph-tight (original text, not the full speech bubble). 82% of already-tight bounds is needlessly restrictive and forces smaller fonts. 88% gives room for Arabic diacritics without wasting space.

## Mask opacity must be 1.0 (not 0.88–0.93)

**Why:** Any opacity < 1 composites the fill over the original image, meaning original text bleeds through at ~7–12% — visible on high-contrast panels. Full opacity + exact bgColor = invisible patch.

## Font ladders

- Dialogue: [22, 20, 18, 16, 14, 12, 10] (starts at 22, was 20)
- SFX: [26, 24, 22, 20, 18, 16] (starts at 26, was 22)
- LINE_HEIGHT_RATIO: 1.3 (was 1.35)
- SFX line-height: 1.15

## Feathering stroke trick

Mask uses `stroke={strokeColor}` (same hue, rgba 0.35) at `strokeWidth={2.5}` on the SVG Rect — creates a subtle bleed at the patch boundary without needing SVG filter effects.
