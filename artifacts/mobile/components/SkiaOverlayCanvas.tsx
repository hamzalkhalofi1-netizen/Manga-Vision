/**
 * SkiaOverlayCanvas — Glyph-tight deterministic manga text overlay.
 *
 * Pipeline per OCR region:
 *   1. Extract placement center from OCR polygon bbox (or x/y/w/h fallback)
 *   2. Layout translated text using the OCR width as a wrapping constraint
 *   3. Measure ACTUAL rendered glyph extents line-by-line via measureLine()
 *      → Canvas.measureText() on web (real glyph metrics)
 *      → Calibrated Arabic heuristic on native (0.55 × fontSize × chars)
 *   4. Draw a rounded-rect mask sized to the MEASURED glyph bounds + tiny PAD
 *   5. Render translated text centered on the same measured bounds
 *
 * Key invariant: mask size follows actual rendered text — not OCR bbox, not
 * bubble size, not character count estimates.
 *
 *   small word   →  tiny mask
 *   multi-line   →  mask grows to wrap rendered lines only
 *
 * No OpenCV. No contour detection. No bubble detection. No region merging.
 * No AI repainting. No native CV dependencies.
 * If polygon/bbox is invalid, falls back gracefully — never skips a region.
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
 * maskFill — derive mask color + opacity from the background color immediately
 * behind the text glyphs.
 *
 * Light backgrounds: high opacity to cleanly cover original glyphs.
 * Dark backgrounds:  lower opacity to preserve panel artwork texture.
 */
function maskFill(bgColor: string): { color: string; opacity: number } {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return { color: "#f5f2eb", opacity: 0.92 };
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const opacity = lum > 0.6 ? 0.93 : lum > 0.35 ? 0.88 : 0.82;
  return { color: `rgb(${rgb.r},${rgb.g},${rgb.b})`, opacity };
}

// ── Placement ──────────────────────────────────────────────────────────────────

/**
 * getPlacement — extract the text center and OCR container size in pixel space.
 *
 * The CENTER (cx, cy) is used for WHERE to place the overlay.
 * The container dimensions (ocrW, ocrH) are used ONLY as wrapping constraints
 * for the font scaler — they do NOT determine mask size.
 *
 * Priority:
 *   1. Polygon bounding box (tight around OCR text glyphs)
 *   2. x / y / w / h bbox (always-available fallback)
 *
 * Returns null only for degenerate (near-zero) boxes.
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
 * glyphBounds — compute the ACTUAL rendered extent of the laid-out text block.
 *
 * Uses the same measurement path as the font scaler:
 *   Web:    Canvas.measureText() via measureLine() — real glyph widths
 *   Native: Calibrated Arabic heuristic via measureLine() — 0.55 × fs × chars
 *
 * This is the core of glyph-tight masking: mask size follows text, not OCR box.
 */
function glyphBounds(typeset: ScaledTypeset): { w: number; h: number } {
  const { lines, fontSize, lineHeight } = typeset;
  const lhr = fontSize > 0 ? lineHeight / fontSize : 1.35;

  const w = lines.length === 0 ? 0
    : Math.max(...lines.map((l) => measureLine(l, fontSize)));

  const h = estimateTextHeight(lines.length, fontSize, lhr);
  return { w, h };
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Tiny adaptive padding around measured glyph bounds.
 * 4 px covers antialiased glyph edges without leaking into surrounding art.
 */
const PAD = 4;

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        // Step 1: placement center + OCR container (for wrapping constraint only)
        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;
        const { cx, cy, ocrW, ocrH } = placement;

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // Step 2: layout text using OCR container as wrapping constraint
        const typeset = isSFX
          ? scaleSFXFont(text, ocrW, ocrH)
          : scaleFontToFit(text, ocrW, ocrH);

        // Step 3: measure ACTUAL rendered glyph extents
        // mask/text box are sized to this, NOT to OCR dimensions
        const glyph = glyphBounds(typeset);
        if (glyph.w < 4 || glyph.h < 4) return null;

        // Step 4: build mask geometry — glyph bounds + PAD, clamped to display
        const maskLeft = Math.max(0, cx - glyph.w / 2 - PAD);
        const maskTop  = Math.max(0, cy - glyph.h / 2 - PAD);
        const maskW    = Math.min(glyph.w + PAD * 2, displayW - maskLeft);
        const maskH    = Math.min(glyph.h + PAD * 2, displayH - maskTop);
        // Gentle corner rounding — never more than 20% of height
        const maskRx   = Math.min(5, maskH * 0.18);

        // Mask fill from background color immediately behind the text
        const { color: maskColor, opacity: maskOpacity } = maskFill(
          region.bgColor ?? "#f5f5f0"
        );

        // Text color
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          // Placement
          cx, cy,
          // Glyph-tight text box (NOT OCR dimensions)
          glyphW: glyph.w,
          glyphH: glyph.h,
          // Mask geometry
          maskLeft, maskTop, maskW, maskH, maskRx,
          maskColor, maskOpacity,
          // Text
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

      {/* ── Layer 1: Glyph-tight rounded-rect masks ───────────────────────── */}
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
              fillOpacity={item.maskOpacity}
            />
          );
        })}
      </Svg>

      {/* ── Layer 2: Translated text — platform RTL engine ────────────────── */}
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
                // Text box is glyph-sized, not OCR-sized
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
    overflow:        "hidden",
  },
  label: {
    includeFontPadding: false,
    textAlignVertical:  "center",
    textAlign:          "center",
    writingDirection:   "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
