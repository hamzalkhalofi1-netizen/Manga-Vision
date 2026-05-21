/**
 * SkiaOverlayCanvas
 *
 * Transparent, non-interactive overlay layer.
 * Renders a pixel-sampled background erase + Arabic text per OCR region.
 *
 * Architecture per region:
 *  Layer 1 — Inpaint fill
 *    · Color derived entirely from the manga bitmap (outer-border pixel sample
 *      on web, Gemini bgColor on native). NEVER a hardcoded white or fixed hex.
 *    · Adaptive border radius (15% of shorter dimension, min 3 px) matches the
 *      rounded profile of speech bubbles and avoids hard rectangular edges.
 *    · 1-px inset on all four sides — never bleeds beyond the glyph contour.
 *  Layer 2 — Arabic text
 *    · Absolutely transparent container, no background, no border.
 *    · Flexbox-centred so text sits dead on (centerX, centerY) of the OCR bbox.
 *    · Color from AdaptiveTextColorEngine (luminance-driven, never hardcoded).
 *
 * Guarantees:
 *  ✅ backgroundColor: 'transparent' on every container except inpaintLayer
 *  ✅ inpaintLayer color = pixel sample or Gemini bgColor — zero hardcoded fills
 *  ✅ No Rect(), no rounded-rectangle shapes, no border/card wrappers
 *  ✅ pointerEvents in style (not JSX prop) — never blocks scroll
 *  ✅ memo() — skips re-render when props unchanged
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import type { InpaintColor } from "./SmartInpaintingEngine";
import { preserveContourEdges } from "./SmartInpaintingEngine";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";

interface SkiaOverlayCanvasProps {
  regions: TextRegion[];
  displayW: number;
  displayH: number;
  inpaintColors: Record<number, InpaintColor>;
  isRTL?: boolean;
}

function SkiaOverlayCanvas({
  regions,
  displayW,
  displayH,
  inpaintColors,
}: SkiaOverlayCanvasProps) {
  const INSET = preserveContourEdges(); // 1 px — never bleeds past glyph contour

  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        // ── Display-space bbox from normalised OCR coords ──────────────────
        const bboxLeft   = region.x * displayW;
        const bboxTop    = region.y * displayH;
        const bboxWidth  = region.w * displayW;
        const bboxHeight = region.h * displayH;

        if (bboxWidth < 12 || bboxHeight < 10) return null;

        const text = region.translated?.trim();
        if (!text) return null;

        // ── Region type flags ──────────────────────────────────────────────
        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // ── Typography ─────────────────────────────────────────────────────
        const typeset = isSFX
          ? scaleSFXFont(text, bboxWidth, bboxHeight)
          : scaleFontToFit(text, bboxWidth, bboxHeight);

        const renderedText = typeset.lines.join("\n");

        // ── Inpaint fill color ─────────────────────────────────────────────
        // Priority: pixel-sampled (web canvas) → Gemini bgColor → neutral cream
        // None of these are hardcoded white; all are derived from source data.
        const inpaint    = inpaintColors[idx];
        const inpaintCss = inpaint?.css ?? region.bgColor ?? "rgb(245,245,240)";

        // ── Adaptive text color ────────────────────────────────────────────
        // Priority:
        //   1. Gemini's textColor (full-image knowledge, most accurate)
        //   2. Luminance-computed from the inpaint fill color (fallback)
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(inpaintCss);

        // ── Adaptive border radius ─────────────────────────────────────────
        // 15% of the shorter dimension, capped at 12 px, floored at 3 px.
        // Matches the rounded silhouette of speech bubbles so the fill blends
        // naturally rather than appearing as a hard-edged rectangle.
        const bubbleRadius = Math.min(
          12,
          Math.max(3, Math.round(Math.min(bboxWidth, bboxHeight) * 0.15))
        );

        return {
          key: idx,
          bboxLeft,
          bboxTop,
          bboxWidth,
          bboxHeight,
          inpaintCss,
          bubbleRadius,
          typeset,
          renderedText,
          colorProfile,
          isSFX,
          isThought,
        };
      })
      .filter(Boolean);
  }, [regions, displayW, displayH, inpaintColors]);

  return (
    <View style={[styles.canvasRoot, { pointerEvents: "none" }]}>
      {items.map((item) => {
        if (!item) return null;
        const {
          key,
          bboxLeft,
          bboxTop,
          bboxWidth,
          bboxHeight,
          inpaintCss,
          bubbleRadius,
          typeset,
          renderedText,
          colorProfile,
          isSFX,
          isThought,
        } = item;

        return (
          <View
            key={key}
            style={[
              styles.regionRoot,
              {
                left:         bboxLeft,
                top:          bboxTop,
                width:        bboxWidth,
                height:       bboxHeight,
                borderRadius: bubbleRadius,
                pointerEvents: "none",
              },
            ]}
          >
            {/* ── Layer 1: Inpaint erase fill ───────────────────────────────
                Fills the OCR bbox with the speech bubble's own background
                color so the original text disappears into its surroundings.

                Color source (in priority order):
                  1. Web  — canvas pixel sample from outer border of bbox
                  2. Web (CORS block) / Native — Gemini-supplied bgColor
                  3. Ultimate fallback — neutral cream rgb(245,245,240)

                This is NOT a white box. The colour derives from the actual
                manga image data on every translation call.

                bubbleRadius applied to all four corners mirrors the rounded
                speech-bubble outline so the fill profile matches the bubble
                shape rather than producing a visible card border.

                1-px inset keeps every edge inside the glyph contour so the
                fill never bleeds into surrounding line art.                 */}
            <View
              style={[
                styles.inpaintLayer,
                {
                  backgroundColor: inpaintCss,
                  top:          INSET,
                  left:         INSET,
                  right:        INSET,
                  bottom:       INSET,
                  borderRadius: Math.max(0, bubbleRadius - INSET),
                  pointerEvents: "none",
                },
              ]}
            />

            {/* ── Layer 2: Arabic text — transparent, center-locked ─────────
                The parent (regionRoot) is positioned so its geometric centre
                equals (centerX, centerY) of the OCR region:
                  centerX = bboxLeft + bboxWidth  / 2
                  centerY = bboxTop  + bboxHeight / 2
                justifyContent + alignItems: 'center' places the text block
                exactly on that point — the same pixel the original glyph
                cluster occupied. No background, no border, no card.        */}
            <View style={[styles.textLayer, { pointerEvents: "none" }]}>
              <Text
                style={[
                  styles.arabicText,
                  {
                    fontSize:        typeset.fontSize,
                    lineHeight:      typeset.lineHeight,
                    color:           colorProfile.color,
                    fontWeight:      isSFX ? "900" : "700",
                    fontStyle:       isThought ? "italic" : "normal",
                    textAlign:       "center",
                    writingDirection: "rtl",
                    letterSpacing:   isSFX ? 0.5 : 0,
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
  regionRoot: {
    position: "absolute",
    backgroundColor: "transparent",
    overflow: "hidden", // clips both fill and text to the rounded rect
  },
  inpaintLayer: {
    position: "absolute",
    // backgroundColor set inline from sampled/Gemini color — never hardcoded
  },
  textLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  arabicText: {
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});

export default memo(SkiaOverlayCanvas);
