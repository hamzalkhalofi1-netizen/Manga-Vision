---
name: SkiaOverlayCanvas erase architecture
description: How the SVG erase/text-bed layers must be configured to fully hide original English text
---

**Rule:** The text bed (LAYER 2) must use `fillOpacity={1}` (100%), NOT 0.92. It must cover the full `bubblePolygon` path. The separate ERASE layer (LAYER 1) is only needed for SFX.

**Why:** At 92% opacity, black ink glyphs bleed through as a visible grey tinge on white bubbles. On dark narration panels with white text, 92% dark-over-white = faint white shadow still visible. 100% fully hides all original ink. The text bed now doubles as the erase layer for non-SFX regions.

**How to apply:**
- Non-SFX: render `textBedPath` (full bubble polygon) at `fillOpacity={1}`, skip the tight OCR erase path.
- SFX: render `erasePath` (tight OCR polygon + 12px expansion) at `fillOpacity={1}`, no text bed.
- Border: increase strokeWidth from 1.2 → 2 and opacity from 0.40 → 0.78 since the 100% fill overwrites the original bubble outline.
- `shouldRenderRegion`: must filter `type === "watermark" | "credits"` and small corner regions before any geometry check.
