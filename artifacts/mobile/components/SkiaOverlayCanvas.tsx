/**
 * SkiaOverlayCanvas — professional visual mask + text overlay system.
 *
 * Pipeline per render:
 *   1. mergeNearbyRegions  — collapse split OCR boxes into unified clusters
 *   2. buildLayoutItems    — typeset text, compute TEXT-sized mask geometry
 *   3. resolveCollisions   — shift overlapping masks vertically
 *   4. Render              — mask View (tight-fit) then text View (centered)
 *
 * Key principle: mask dimensions are derived from RENDERED TEXT SIZE, not
 * from the raw OCR bounding box.  The OCR box is used only as a position
 * anchor (center point).  This produces small, precise overlays instead of
 * giant rectangles.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";

interface SkiaOverlayCanvasProps {
  regions: TextRegion[];
  displayW: number;
  displayH: number;
  isRTL?: boolean;
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

/**
 * Adaptive mask fill derived from the region's Gemini-supplied bgColor.
 *
 * Light background → near-white tinted fill  (alpha 0.87)
 * Dark  background → near-black tinted fill  (alpha 0.82)
 *
 * Opacity is intentionally below 0.90 so the mask blends softly with the
 * original image rather than creating a hard opaque rectangle.
 */
function adaptiveMaskColor(bgColor: string): string {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return "rgba(252,252,252,0.87)";

  // Perceptual luminance (BT.601)
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;

  if (lum > 0.5) {
    // Light background — blend 15% original tint into near-white
    const r = Math.min(255, Math.round(rgb.r * 0.18 + 209));
    const g = Math.min(255, Math.round(rgb.g * 0.18 + 209));
    const b = Math.min(255, Math.round(rgb.b * 0.18 + 209));
    return `rgba(${r},${g},${b},0.87)`;
  } else {
    // Dark background — blend 20% original tint into near-black
    const r = Math.max(0, Math.round(rgb.r * 0.22 + 8));
    const g = Math.max(0, Math.round(rgb.g * 0.22 + 10));
    const b = Math.max(0, Math.round(rgb.b * 0.22 + 22));
    return `rgba(${r},${g},${b},0.82)`;
  }
}

// ── Region merging ────────────────────────────────────────────────────────────

/**
 * Returns true when two OCR boxes are close enough to belong to the same
 * speech-bubble line cluster and should be merged.
 *
 * Criteria (normalised coordinate space):
 *   • Vertical gap between box bottoms/tops < 100% of the taller box height.
 *   • Horizontal ranges overlap, OR the gap is < 30% of the narrower width.
 */
function shouldMerge(a: TextRegion, b: TextRegion): boolean {
  const maxH = Math.max(a.h, b.h);

  // Vertical proximity — account for either order
  const topGap = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  if (topGap > maxH * 1.0) return false;

  // Horizontal proximity
  const aLeft = a.x,   aRight = a.x + a.w;
  const bLeft = b.x,   bRight = b.x + b.w;
  const overlap = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
  if (overlap < 0) {
    // No horizontal overlap — allow a small gap
    const minW = Math.min(a.w, b.w);
    if (-overlap > minW * 0.30) return false;
  }

  return true;
}

function mergeTwo(a: TextRegion, b: TextRegion): TextRegion {
  const newX = Math.min(a.x, b.x);
  const newY = Math.min(a.y, b.y);
  const newR = Math.max(a.x + a.w, b.x + b.w);
  const newB = Math.max(a.y + a.h, b.y + b.h);
  const newW = newR - newX;
  const newH = newB - newY;

  // Use bgColor / textColor of the larger-area region
  const aArea  = a.w * a.h;
  const bArea  = b.w * b.h;
  const dominant = aArea >= bArea ? a : b;

  // Join translations with a space (same line) or newline (stacked)
  const sameLineY = Math.abs(a.centerY! - b.centerY!) < Math.max(a.h, b.h) * 0.6;
  const sep = sameLineY ? " " : " ";

  return {
    ...dominant,
    x: newX,
    y: newY,
    w: newW,
    h: newH,
    centerX: newX + newW / 2,
    centerY: newY + newH / 2,
    translated: [a.translated?.trim(), b.translated?.trim()].filter(Boolean).join(sep),
    original:   [a.original?.trim(),   b.original?.trim()  ].filter(Boolean).join(sep),
  };
}

/**
 * Iteratively merge OCR regions until no more merges are possible.
 * Typical manga issue: one sentence split into 2–4 tiny boxes.
 */
function mergeNearbyRegions(regions: TextRegion[]): TextRegion[] {
  if (regions.length <= 1) return regions;

  // Sort top-to-bottom, left-to-right
  let pool = [...regions].sort((a, b) => a.y - b.y || a.x - b.x);

  let anyMerge = true;
  while (anyMerge) {
    anyMerge = false;
    const result: TextRegion[] = [];
    const used = new Set<number>();

    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      let cluster = pool[i];

      for (let j = i + 1; j < pool.length; j++) {
        if (used.has(j)) continue;
        if (shouldMerge(cluster, pool[j])) {
          cluster = mergeTwo(cluster, pool[j]);
          used.add(j);
          anyMerge = true;
        }
      }

      used.add(i);
      result.push(cluster);
    }

    pool = result;
  }

  return pool;
}

// ── Layout item ───────────────────────────────────────────────────────────────

interface LayoutItem {
  key:          number;
  cx:           number;   // display-space center X (anchor for text)
  cy:           number;   // display-space center Y (anchor for text, mutable)
  textW:        number;   // estimated rendered text block width
  textH:        number;   // estimated rendered text block height
  maskLeft:     number;   // mask rect (mutable after collision pass)
  maskTop:      number;   // mask rect (mutable after collision pass)
  maskW:        number;
  maskH:        number;
  borderRadius: number;
  maskColor:    string;
  typeset:      ReturnType<typeof scaleFontToFit>;
  renderedText: string;
  colorProfile: ReturnType<typeof resolveFromGeminiTextColor>;
  isSFX:        boolean;
  isThought:    boolean;
}

// ── Collision resolution ──────────────────────────────────────────────────────

/**
 * Shift overlapping mask rects downward so they no longer intersect.
 * Works top-to-bottom: each item can only push items below it.
 */
function resolveCollisions(items: LayoutItem[], displayH: number): LayoutItem[] {
  if (items.length <= 1) return items;

  const sorted = [...items].sort((a, b) => a.maskTop - b.maskTop);

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];

    for (let j = 0; j < i; j++) {
      const prev = sorted[j];

      // Horizontal overlap?
      const hOverlap =
        Math.min(prev.maskLeft + prev.maskW, curr.maskLeft + curr.maskW) -
        Math.max(prev.maskLeft, curr.maskLeft);
      if (hOverlap <= 2) continue; // no meaningful horizontal overlap

      // Vertical overlap?
      const vBottom   = prev.maskTop + prev.maskH;
      const vOverlap  = vBottom - curr.maskTop;
      if (vOverlap <= 0) continue; // already clear

      // Push curr below prev with a 3 px gap
      curr.maskTop = vBottom + 3;
      curr.cy      = curr.maskTop + curr.maskH / 2;

      // Clamp to display bounds
      const maxTop = displayH - curr.maskH;
      if (curr.maskTop > maxTop) {
        curr.maskTop = Math.max(0, maxTop);
        curr.cy      = curr.maskTop + curr.maskH / 2;
      }
    }
  }

  return sorted;
}

// ── Component ─────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH }: SkiaOverlayCanvasProps) {

  const items = useMemo((): LayoutItem[] => {
    if (!regions.length) return [];

    // ── Step 1: merge nearby OCR boxes ─────────────────────────────────────
    const merged = mergeNearbyRegions(regions);

    // ── Step 2: typeset + compute text-sized mask geometry ─────────────────
    const laid: LayoutItem[] = [];

    merged.forEach((region, idx) => {
      const bboxW = region.w * displayW;
      const bboxH = region.h * displayH;
      if (bboxW < 10 || bboxH < 8) return;

      const text = region.translated?.trim();
      if (!text) return;

      // Exact center in display-space pixels
      const cx = (region.centerX ?? region.x + region.w / 2) * displayW;
      const cy = (region.centerY ?? region.y + region.h / 2) * displayH;

      const isSFX     = region.type === "sfx";
      const isThought = region.type === "thought";

      // Typeset using OCR bbox as the constraint — produces tight lines
      const typeset = isSFX
        ? scaleSFXFont(text, bboxW, bboxH)
        : scaleFontToFit(text, bboxW, bboxH);

      const renderedText = typeset.lines.join("\n");
      const fontSize     = typeset.fontSize;

      // ── Mask: sized to RENDERED TEXT, not to OCR box ──────────────────
      // textW / textH come from the font scaler's own estimation.
      const textW = typeset.textW;
      const textH = typeset.textH;

      // Padding tied to font size
      const padX = Math.ceil(fontSize * 0.8);
      const padY = Math.ceil(fontSize * 0.45);

      // Raw mask dimensions centered on (cx, cy)
      const rawMaskW = textW + padX * 2;
      const rawMaskH = textH + padY * 2;

      // Clamp mask to stay within display bounds
      const maskW    = Math.min(rawMaskW, displayW);
      const maskH    = Math.min(rawMaskH, displayH);
      const maskLeft = Math.max(0, Math.min(cx - maskW / 2, displayW - maskW));
      const maskTop  = Math.max(0, Math.min(cy - maskH / 2, displayH - maskH));

      if (maskW < 4 || maskH < 4) return;

      // Proportional corner radius
      const borderRadius = Math.min(10, maskH * 0.25);

      // Adaptive fill from Gemini bgColor
      const maskColor = adaptiveMaskColor(region.bgColor ?? "#ffffff");

      // Text colour
      const colorProfile = region.textColor
        ? resolveFromGeminiTextColor(region.textColor)
        : resolveFromCss(region.bgColor ?? "#ffffff");

      laid.push({
        key: idx,
        cx, cy,
        textW, textH,
        maskLeft, maskTop, maskW, maskH,
        borderRadius,
        maskColor,
        typeset,
        renderedText,
        colorProfile,
        isSFX,
        isThought,
      });
    });

    // ── Step 3: resolve mask collisions ────────────────────────────────────
    return resolveCollisions(laid, displayH);

  }, [regions, displayW, displayH]);

  if (!items.length) return null;

  return (
    <View style={[styles.canvasRoot, { pointerEvents: "none" }]}>
      {items.map((item) => {
        const {
          key,
          cx, cy,
          textW, textH,
          maskLeft, maskTop, maskW, maskH,
          borderRadius,
          maskColor,
          typeset,
          renderedText,
          colorProfile,
          isSFX,
          isThought,
        } = item;

        // Text container is sized to the estimated text block (not the OCR box)
        // and centered at the (possibly collision-adjusted) cy anchor.
        const textContLeft = cx    - textW / 2;
        const textContTop  = cy    - textH / 2;

        return (
          <React.Fragment key={key}>

            {/* ── Layer 1: adaptive mask ─────────────────────────────────── */}
            <View
              style={[
                styles.maskBase,
                {
                  left:            maskLeft,
                  top:             maskTop,
                  width:           maskW,
                  height:          maskH,
                  borderRadius,
                  backgroundColor: maskColor,
                  ...Platform.select({
                    ios: {
                      shadowColor:   "rgba(0,0,0,0.20)",
                      shadowOffset:  { width: 0, height: 0 },
                      shadowOpacity: 1,
                      shadowRadius:  3,
                    },
                    android: { elevation: 2 },
                    web: {
                      boxShadow: "0 0 3px rgba(0,0,0,0.20)",
                      filter:    "blur(0.5px)",
                    } as object,
                    default: {},
                  }),
                },
              ]}
            />

            {/* ── Layer 2: translated Arabic text ──────────────────────── */}
            <View
              style={[
                styles.textContainer,
                {
                  left:   textContLeft,
                  top:    textContTop,
                  width:  textW,
                  height: textH,
                  pointerEvents: "none",
                },
              ]}
            >
              <Text
                style={[
                  styles.translatedText,
                  {
                    fontSize:      typeset.fontSize,
                    lineHeight:    typeset.lineHeight,
                    color:         colorProfile.color,
                    fontWeight:    isSFX ? "900" : "700",
                    fontStyle:     isThought ? "italic" : "normal",
                    letterSpacing: isSFX ? 0.5 : 0,
                    ...Platform.select({
                      web: {
                        textShadow: `0px 0px ${colorProfile.shadowRadius}px ${colorProfile.shadowColor}`,
                      },
                      default: {
                        textShadowColor:  colorProfile.shadowColor,
                        textShadowOffset: { width: 0, height: 0 },
                        textShadowRadius: colorProfile.shadowRadius,
                      },
                    }),
                  },
                ]}
              >
                {renderedText}
              </Text>
            </View>

          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvasRoot: {
    position:        "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "transparent",
  },
  maskBase: {
    position:        "absolute",
    overflow:        "hidden",
  },
  textContainer: {
    position:        "absolute",
    backgroundColor: "transparent",
    justifyContent:  "center",
    alignItems:      "center",
    overflow:        "hidden",
  },
  translatedText: {
    includeFontPadding:  false,
    textAlignVertical:   "center",
    textAlign:           "center",
    writingDirection:    "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
