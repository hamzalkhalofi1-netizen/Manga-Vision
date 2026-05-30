---
name: Overlay rendering architecture
description: How manga translation bubbles are erased and redrawn with Arabic text — 2-layer solid erase + dark bg approach
---

## Architecture (2-layer approach, replaces old 3-layer feather mask)

### Layer 1 — ERASE (SVG, solid)
- Fill = `region.bgColor` at opacity 1.0
- Path = `bubblePolygon` (Gemini-provided, 4–8 pts) OR OCR polygon expanded 35%
- Smooth bezier path (midpoint technique) matches bubble silhouette
- Tiny extra 3px expansion for clean edge coverage

### Layer 2 — DARK BACKGROUND (SVG, 78% opacity)
- Fill = `#000000` at opacity 0.78
- Same bubble path — consistent dark surface for white Arabic text
- Skipped for SFX (sound effects displayed directly on artwork)

### Layer 3 — BORDER (SVG, optional polish)
- White stroke at 18% opacity around bubble edge

### Layer 4 — TEXT (React Native View)
- Always white (#FFFFFF), SFX use yellow (#FFE566)
- Container = bubble AABB × 85% safe zone, centered in AABB
- `overflow: hidden` prevents any text bleed outside bubble
- Font cascade: 24→22→20→18→16→14→12→10→8 px

## Bubble polygon source (priority)
1. `region.bubblePolygon` — Gemini full bubble outline (added to prompt, 4–8 pts)
2. OCR polygon expanded 35% from centroid (`BUBBLE_EXPAND_RATIO=0.35`, min 20px)
3. Bounding box expanded — last resort

## Key constants (SkiaOverlayCanvas.tsx)
- `TEXT_SAFE = 0.85` — safe zone fraction of bubble AABB
- `BUBBLE_BG_OPACITY = 0.78`
- `BUBBLE_EXPAND_RATIO = 0.35`, `BUBBLE_EXPAND_MIN_PX = 20`
- `DEBUG_OVERLAY = false` — set true to draw red bubble outline, blue OCR outline, green container rect, font size label

## Font scaling (ArabicTypesettingEngine.ts + DynamicFontScaler.ts)
- `getSafeZone` = 85% of bubble AABB (was 91%)
- Dialogue ladder: `[24, 22, 20, 18, 16, 14, 12, 10, 8]` (was 10 min)
- SFX ladder: `[30, 28, 26, 24, 22, 20, 18, 16, 14]`
- `estimateTextHeight` adds 10% buffer for Arabic diacritics

## Translation queue (translationQueue.ts)
- Phase 1: instant cache flush for all cached pages
- Phase 2: parallel batches of 4 (`PARALLEL_BATCH_SIZE=4`), 500ms between batches
- ~4× speed improvement over old sequential + 1500ms delay approach
- Rate limit on any page → abort all remaining

## Gemini prompt (geminiTranslate.ts)
- Now requests `bubblePolygon` in addition to `polygon` (glyph tight)
- Stronger "never merge regions" rule — each bubble = one region
- `validateBubblePolygon` accepts 3–16 points

**Why:** Old 3-layer feather mask caused: (1) white patches from halo spillage outside bubble, (2) incomplete erasure because core expand was only 8px. New solid-erase approach guarantees full ink coverage; dark bg gives consistent readable surface; bubblePolygon from Gemini gives accurate bubble shape bounds.
