---
name: Overlay rendering architecture
description: How manga translation bubbles are erased and redrawn — natural bgColor fill approach, NO dark overlay
---

## Architecture (3-layer SVG + text, natural colour fill)

### Layer 1 — ERASE (SVG, full opacity)
- Fill = `region.bgColor` at opacity 1.0
- Path = OCR glyph polygon + ERASE_EXPAND_PX (4px) — TIGHT, glyph-only
- DOES NOT use the bubble polygon — preserves bubble border and artwork
- Smooth bezier path (midpoint technique)

### Layer 2 — TEXT BED (SVG, 92% opacity)
- Fill = `region.bgColor` at opacity 0.92
- Path = `bubblePolygon` (Gemini-provided) OR OCR polygon expanded 20%
- NO dark overlay — fills with natural bubble colour:
  - White speech bubble → white fill → dark text (#1A1A1A) on top
  - Dark panel          → dark fill  → light text (#F8F8F8) on top
- Skipped for SFX

### Layer 3 — BORDER (SVG)
- Dark stroke `rgba(20,20,20,0.40)` for light bubbles (restores black outline)
- Light stroke `rgba(220,220,220,0.45)` for dark panels
- Dashed `4 3` pattern for thought bubbles
- Skipped for SFX

### Layer 4 — TEXT (React Native View)
- Colour from `resolveFromCss(bgColor)` via AdaptiveTextColorEngine — NOT hardcoded white
- Light bubble → `#1A1A1A` dark text with light halo
- Dark panel   → `#F8F8F8` light text with dark halo
- SFX          → `#FFE566` yellow with heavy shadow
- Container = bubble AABB × 88% safe zone (TEXT_SAFE), centered in AABB
- `overflow: hidden` prevents text bleed outside bubble
- Font cascade: 24→22→20→18→16→14→12→10→8 px

## Bubble polygon source (priority)
1. `region.bubblePolygon` — Gemini full bubble outline (4–8 pts, now in both prompts)
2. OCR polygon expanded 20% from centroid (`TEXT_BED_EXPAND_RATIO=0.20`, min 14px)
   — reduced from old 0.35 to preserve more artwork
3. Bounding box expanded — last resort

## Key constants (SkiaOverlayCanvas.tsx)
- `TEXT_SAFE = 0.88`
- `TEXT_BED_EXPAND_RATIO = 0.20`, `TEXT_BED_EXPAND_MIN_PX = 14`
- `ERASE_EXPAND_PX = 4` (tight glyph removal — was using bubblePts + 3px which was OCR×1.35+3px)
- `DEBUG_OVERLAY = false` — set true for red/blue/green polygon outlines + font size label

## Root causes that were fixed
1. `BUBBLE_BG_OPACITY = 0.78` black overlay → destroyed artwork (removed entirely)
2. Erase used `expandPolygon(bubblePts, cx, cy, 3)` — bubblePts was ALREADY 35% expanded,
   so erase was OCR×1.35+3px. Changed to `expandPolygon(ocrPts, cx, cy, 4)` (tight)
3. Text colour hardcoded `#FFFFFF` — now adaptive via `resolveFromCss(bgColor)`
4. `bubblePolygon` missing from server route (translate-image.ts) — now added with
   `validateBubblePolygon()` function

## Gemini prompt (both geminiTranslate.ts AND translate-image.ts)
- Explicitly requests `bubblePolygon` (4–8 pts, round bubbles need 6+)
- `polygon` = glyph-tight only (4 pts)
- Both prompts now match in schema

**Why:** Old dark overlay (78% black) created large black rectangles over artwork whenever
the over-expanded OCR polygon (35%) extended outside the actual bubble. Removing the overlay
and using bgColor fill means: white bubble = white fill, which looks exactly like the original
unmodified bubble — completely invisible except that the Japanese text is replaced. Adaptive
text colour from WCAG luminance gives ~14:1 contrast without any overlay.
