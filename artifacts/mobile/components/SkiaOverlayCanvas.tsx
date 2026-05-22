/**
 * SkiaOverlayCanvas
 *
 * Text-only transparent overlay.  The server has already pixel-erased the
 * original text from the manga image (POST /api/inpaint).  This layer does
 * exactly one thing: render the translated text centered on each OCR bbox.
 *
 * Architecture per region:
 *  · Absolutely positioned container anchored at the exact center of the OCR
 *    bbox — (centerX × displayW, centerY × displayH) — then shifted left/up
 *    by half its own width/height via transform so the geometric center of
 *    the container aligns perfectly with the center of the original glyph
 *    cluster.
 *  · backgroundColor: 'transparent' everywhere — zero fills.
 *  · pointerEvents: 'none' — never intercepts scroll or tap events.
 *
 * Guarantees:
 *  ✅ Zero fill rectangles  ✅ Zero inpaint shapes  ✅ Zero white backgrounds
 *  ✅ 100% transparent canvas root and every text container
 *  ✅ Text anchored at exact (centerX, centerY) — no drift
 *  ✅ memo() — skips re-render when props unchanged
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

function SkiaOverlayCanvas({
  regions,
  displayW,
  displayH,
}: SkiaOverlayCanvasProps) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        // ── Display-space bbox from normalised OCR coords ──────────────────
        const bboxW = region.w * displayW;
        const bboxH = region.h * displayH;

        if (bboxW < 12 || bboxH < 10) return null;

        const text = region.translated?.trim();
        if (!text) return null;

        // ── Exact center point ─────────────────────────────────────────────
        // Prefer the server-computed centerX/centerY fields (set by
        // translate-image.ts: centerX = x + w/2, centerY = y + h/2).
        // Fall back to computing them here if the field is missing.
        const cx = (region.centerX ?? region.x + region.w / 2) * displayW;
        const cy = (region.centerY ?? region.y + region.h / 2) * displayH;

        // ── Region type flags ──────────────────────────────────────────────
        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // ── Typography ─────────────────────────────────────────────────────
        const typeset = isSFX
          ? scaleSFXFont(text, bboxW, bboxH)
          : scaleFontToFit(text, bboxW, bboxH);

        const renderedText = typeset.lines.join("\n");

        // ── Text color ─────────────────────────────────────────────────────
        // Gemini supplies the correct foreground color from the full image.
        // Fallback: luminance-computed from the region's bgColor field.
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          cx,
          cy,
          bboxW,
          bboxH,
          typeset,
          renderedText,
          colorProfile,
          isSFX,
          isThought,
        };
      })
      .filter(Boolean);
  }, [regions, displayW, displayH]);

  return (
    <View style={[styles.canvasRoot, { pointerEvents: "none" }]}>
      {items.map((item) => {
        if (!item) return null;
        const {
          key,
          cx,
          cy,
          bboxW,
          bboxH,
          typeset,
          renderedText,
          colorProfile,
          isSFX,
          isThought,
        } = item;

        return (
          /**
           * Text container:
           *   left  = centerX  (the exact horizontal center of the OCR bbox)
           *   top   = centerY  (the exact vertical   center of the OCR bbox)
           *   transform shifts the box left and up by half its own dimensions
           *   so the geometric center of this container sits precisely on
           *   (centerX, centerY) — matching where the original text lived.
           *
           *   No backgroundColor. No border. No fill. Pure text.
           */
          <View
            key={key}
            style={[
              styles.textContainer,
              {
                left:   cx,
                top:    cy,
                width:  bboxW,
                height: bboxH,
                transform: [
                  { translateX: -bboxW / 2 },
                  { translateY: -bboxH / 2 },
                ],
                pointerEvents: "none",
              },
            ]}
          >
            <Text
              style={[
                styles.translatedText,
                {
                  fontSize:         typeset.fontSize,
                  lineHeight:       typeset.lineHeight,
                  color:            colorProfile.color,
                  fontWeight:       isSFX ? "900" : "700",
                  fontStyle:        isThought ? "italic" : "normal",
                  letterSpacing:    isSFX ? 0.5 : 0,
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
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvasRoot: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  textContainer: {
    position: "absolute",
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  translatedText: {
    includeFontPadding: false,
    textAlignVertical: "center",
    textAlign: "center",
    writingDirection: "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
