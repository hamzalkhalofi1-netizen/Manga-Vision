/**
 * SkiaOverlayCanvas — Simple deterministic manga text overlay.
 *
 * Pipeline per OCR region (fully independent, no cross-region awareness):
 *   1. Get tight pixel bounds from OCR data (polygon bbox → fallback to x/y/w/h)
 *   2. Expand by a small fixed padding (PAD px)
 *   3. Draw a lightweight rounded-rect mask using the text background color
 *   4. Render translated text centered over the original text area
 *
 * No bubble detection. No polygon geometry rendering. No region merging.
 * No collision logic. No AI repainting. No perspective math.
 * If polygon is invalid, falls back to bbox — never silently skips a region.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
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
 * maskFill — derive mask color and opacity from the background color
 * immediately behind the text.
 *
 * Light backgrounds (white bubbles): high opacity to cover original glyphs.
 * Dark backgrounds (dark panels):    lower opacity to preserve artwork texture.
 */
function maskFill(bgColor: string): { color: string; opacity: number } {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return { color: "#f5f2eb", opacity: 0.92 };
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const opacity = lum > 0.6 ? 0.93 : lum > 0.35 ? 0.88 : 0.82;
  return { color: `rgb(${rgb.r},${rgb.g},${rgb.b})`, opacity };
}

// ── Bounds ─────────────────────────────────────────────────────────────────────

/**
 * getTextBounds — compute the pixel-space center and size of an OCR text region.
 *
 * Priority:
 *   1. Polygon bounding box — most accurate, derived from tight text-glyph coords
 *   2. x / y / w / h bbox   — always-available fallback
 *
 * Returns null only if both sources produce a degenerate (near-zero) box.
 */
function getTextBounds(
  region: TextRegion,
  displayW: number,
  displayH: number
): { cx: number; cy: number; w: number; h: number } | null {
  let cx: number, cy: number, bw: number, bh: number;

  if (region.polygon && region.polygon.length >= 3) {
    // Derive axis-aligned bbox from the OCR polygon
    const xs = region.polygon.map(([x]) => x * displayW);
    const ys = region.polygon.map(([, y]) => y * displayH);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    bw = maxX - minX;
    bh = maxY - minY;
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
  } else {
    // Fallback: use normalized x/y/w/h from the OCR response
    bw = region.w * displayW;
    bh = region.h * displayH;
    cx = (region.centerX ?? region.x + region.w / 2) * displayW;
    cy = (region.centerY ?? region.y + region.h / 2) * displayH;
  }

  if (bw < 8 || bh < 6) return null;
  return { cx, cy, w: bw, h: bh };
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Tight local padding around OCR text bounds. 4 px is enough to cover
 *  antialiased glyph edges without expanding into surrounding art. */
const PAD = 4;

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        const bounds = getTextBounds(region, displayW, displayH);
        if (!bounds) return null;

        const { cx, cy, w, h } = bounds;

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // Scale font to fit within the detected text area
        const typeset = isSFX
          ? scaleSFXFont(text, w, h)
          : scaleFontToFit(text, w, h);

        // Mask: tight text bounds + PAD, clamped to display edges
        const maskLeft = Math.max(0, cx - w / 2 - PAD);
        const maskTop  = Math.max(0, cy - h / 2 - PAD);
        const maskW    = Math.min(w + PAD * 2, displayW - maskLeft);
        const maskH    = Math.min(h + PAD * 2, displayH - maskTop);
        // Corner radius: gentle rounding, never exceeds 20% of height
        const maskRx   = Math.min(5, maskH * 0.18);

        // Mask color from the background immediately behind the text
        const { color: maskColor, opacity: maskOpacity } = maskFill(
          region.bgColor ?? "#f5f5f0"
        );

        // Text color: use Gemini-supplied textColor when available
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          cx, cy, w, h,
          maskLeft, maskTop, maskW, maskH, maskRx,
          maskColor, maskOpacity,
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

      {/* ── Layer 1: Local rounded-rect readability masks ─────────────────── */}
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
          key, cx, cy, w, h,
          typeset, renderedText, colorProfile,
          isSFX, isThought,
        } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                left:   cx - w / 2,
                top:    cy - h / 2,
                width:  w,
                height: h,
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
                  // Arabic MUST be 0 — any positive tracking breaks glyph joining
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
