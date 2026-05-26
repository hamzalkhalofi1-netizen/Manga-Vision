/**
 * SkiaOverlayCanvas — Professional scanlation-style manga text overlay.
 *
 * Pipeline per OCR region:
 *   1. Extract OCR placement center + dimensions from polygon bbox (or x/y/w/h)
 *   2. Layout translated text using OCR width as wrapping constraint
 *   3. Measure ACTUAL rendered glyph extents via measureLine()
 *   4. Draw a FULL-COVERAGE mask over the ORIGINAL text area (OCR bbox + 3px pad)
 *      at 100% opacity using the exact sampled bubble background color
 *   5. Add a soft feathering stroke around the mask edges to blend with bubble art
 *   6. Render translated Arabic text centered on the same OCR center point
 *
 * Key invariant: mask covers the ORIGINAL text bounding box to ensure complete
 * erasure of source glyphs. Text is independently sized to its own glyph bounds.
 *
 *   original long line  → mask covers full OCR width → no text leaks at edges
 *   short translation   → mask still covers full OCR area → clean patch
 *
 * No OpenCV. No contour detection. No AI repainting. No native CV dependencies.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import type { ScaledTypeset } from "./DynamicFontScaler";
import { measureLine, estimateTextHeight } from "./ArabicTypesettingEngine";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";
import { ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";

interface Props {
  regions:  TextRegion[];
  displayW: number;
  displayH: number;
  isRTL?:   boolean;
}

// ── Color ──────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * maskFill — exact bubble background color at 100% opacity.
 *
 * Professional scanlation technique: paint over the original text with
 * the exact background fill so the patch is visually invisible.
 * Full opacity ensures ZERO bleed-through of original glyphs.
 *
 * Stroke feathering (separate, low-opacity) handles edge blending.
 */
function maskFill(bgColor: string): { color: string; strokeColor: string } {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return { color: "#f5f2eb", strokeColor: "rgba(245,242,235,0.35)" };
  const colorStr = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  // Stroke is same hue but very translucent — blends mask edge into surrounding art
  const strokeStr = `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`;
  return { color: colorStr, strokeColor: strokeStr };
}

// ── Placement ──────────────────────────────────────────────────────────────────

/**
 * getPlacement — extract OCR center and ORIGINAL text dimensions.
 *
 * The CENTER (cx, cy) is where the translated text will be placed.
 * The OCR dimensions (ocrW, ocrH) define the MASK size (original text area)
 * AND are used as the wrapping constraint for the font scaler.
 *
 * Priority:
 *   1. Polygon bounding box (tight around OCR text glyphs)
 *   2. x / y / w / h bbox (always-available fallback)
 */
function getPlacement(
  region: TextRegion,
  displayW: number,
  displayH: number
): { cx: number; cy: number; ocrW: number; ocrH: number } | null {
  let cx: number, cy: number, ocrW: number, ocrH: number;

  if (region.polygon && region.polygon.length >= 3) {
    const xs = region.polygon.map(([x]) => x * displayW);
    const ys = region.polygon.map(([, y]) => y * displayH);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    ocrW = maxX - minX;
    ocrH = maxY - minY;
    cx   = (minX + maxX) / 2;
    cy   = (minY + maxY) / 2;
  } else {
    ocrW = region.w * displayW;
    ocrH = region.h * displayH;
    cx   = (region.centerX ?? region.x + region.w / 2) * displayW;
    cy   = (region.centerY ?? region.y + region.h / 2) * displayH;
  }

  if (ocrW < 8 || ocrH < 6) return null;
  return { cx, cy, ocrW, ocrH };
}

// ── Glyph measurement ──────────────────────────────────────────────────────────

/**
 * glyphBounds — actual rendered extent of the translated text block.
 *
 * Used ONLY for positioning the text view, not for mask sizing.
 * Mask sizing is always driven by OCR dimensions (original text area).
 */
function glyphBounds(typeset: ScaledTypeset): { w: number; h: number } {
  const { lines, fontSize, lineHeight } = typeset;
  const lhr = fontSize > 0 ? lineHeight / fontSize : 1.3;

  const w = lines.length === 0 ? 0
    : Math.max(...lines.map((l) => measureLine(l, fontSize)));

  const h = estimateTextHeight(lines.length, fontSize, lhr);
  return { w, h };
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * How much to expand the mask beyond the OCR bbox on each side.
 *
 * 3px catches anti-aliased glyph edges that extend just past the bbox boundary.
 * Large enough to guarantee full coverage, small enough to avoid bubble art bleed.
 */
const MASK_EXPAND = 3;

/**
 * Stroke width for the feathering ring around the mask.
 * Same color as mask fill at low opacity — creates a soft blend into bubble art.
 */
const STROKE_W = 2.5;

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        // Step 1: OCR placement center + original text dimensions
        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;
        const { cx, cy, ocrW, ocrH } = placement;

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // Step 2: layout translated text, constrained by OCR dimensions
        const typeset = isSFX
          ? scaleSFXFont(text, ocrW, ocrH)
          : scaleFontToFit(text, ocrW, ocrH);

        // Step 3: measure rendered glyph extents (for text view positioning only)
        const glyph = glyphBounds(typeset);
        if (glyph.w < 4 || glyph.h < 4) return null;

        // ── Step 4: MASK covers the ORIGINAL text area (OCR bbox) + expansion ──
        //
        // This is the critical professional-quality rule:
        //   mask follows WHERE THE ORIGINAL TEXT WAS, not where Arabic text will be.
        //   If translated text is shorter, original still gets fully covered.
        //
        const maskLeft = Math.max(0, cx - ocrW / 2 - MASK_EXPAND);
        const maskTop  = Math.max(0, cy - ocrH / 2 - MASK_EXPAND);
        const maskW    = Math.min(ocrW + MASK_EXPAND * 2, displayW - maskLeft);
        const maskH    = Math.min(ocrH + MASK_EXPAND * 2, displayH - maskTop);

        // Corner radius: speech bubbles have rounded corners.
        // Scale with bubble height — taller bubble = more pronounced rounding.
        const maskRx = Math.min(maskH * 0.28, 14);

        // Step 5: bubble-matched fill colors
        const { color: maskColor, strokeColor } = maskFill(
          region.bgColor ?? "#f5f5f0"
        );

        // Text color derived from bubble background or Gemini hint
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          // OCR center (placement target)
          cx, cy,
          // Glyph-tight text box dimensions (NOT mask dimensions)
          glyphW: glyph.w,
          glyphH: glyph.h,
          // Mask geometry (covers original text area)
          maskLeft, maskTop, maskW, maskH, maskRx,
          maskColor, strokeColor,
          // Text layout
          typeset,
          renderedText: typeset.lines.join("\n"),
          colorProfile,
          isSFX,
          isThought,
        };
      })
      .filter(Boolean);
  }, [regions, displayW, displayH]);

  if (!items.length) return null;

  return (
    <View style={[styles.root, { pointerEvents: "none" }]}>

      {/* ── Layer 1: Full-coverage OCR-bbox masks with feathered stroke ───── */}
      <Svg
        width={displayW}
        height={displayH}
        style={StyleSheet.absoluteFillObject}
      >
        {items.map((item) => {
          if (!item) return null;
          return (
            <Rect
              key={`mask-${item.key}`}
              x={item.maskLeft}
              y={item.maskTop}
              width={item.maskW}
              height={item.maskH}
              rx={item.maskRx}
              ry={item.maskRx}
              fill={item.maskColor}
              fillOpacity={1}
              stroke={item.strokeColor}
              strokeWidth={STROKE_W}
            />
          );
        })}
      </Svg>

      {/* ── Layer 2: Translated Arabic text — platform RTL engine ────────── */}
      {items.map((item) => {
        if (!item) return null;
        const {
          key, cx, cy, glyphW, glyphH,
          typeset, renderedText, colorProfile,
          isSFX, isThought,
        } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                // Text view is glyph-sized, centered on OCR center
                left:   cx - glyphW / 2,
                top:    cy - glyphH / 2,
                width:  glyphW,
                height: glyphH,
                pointerEvents: "none",
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  fontSize:      typeset.fontSize,
                  lineHeight:    typeset.lineHeight,
                  color:         colorProfile.color,
                  fontFamily:    ARABIC_FONT_FAMILY,
                  fontWeight:    isSFX     ? "900" : "700",
                  fontStyle:     isThought ? "italic" : "normal",
                  // Arabic: letterSpacing MUST be 0 — any positive value
                  // breaks contextual glyph joining (initial/medial/final forms)
                  letterSpacing: 0,
                  ...Platform.select({
                    web: {
                      textShadow:          `0px 0px ${colorProfile.shadowRadius}px ${colorProfile.shadowColor}`,
                      WebkitFontSmoothing: "antialiased",
                      textRendering:       "optimizeLegibility",
                    } as object,
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
        );
      })}

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position:        "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "transparent",
  },
  textBox: {
    position:        "absolute",
    backgroundColor: "transparent",
    justifyContent:  "center",
    alignItems:      "center",
    overflow:        "visible",
  },
  label: {
    includeFontPadding: false,
    textAlignVertical:  "center",
    textAlign:          "center",
    writingDirection:   "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
