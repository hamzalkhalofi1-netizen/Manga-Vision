/**
 * SkiaOverlayCanvas
 *
 * Fully transparent, non-interactive overlay layer.
 * Renders ONLY Arabic typography — zero backgrounds, zero borders,
 * zero synthetic geometry.
 *
 * Rendering contract:
 *  - backgroundColor: 'transparent' on ALL containers
 *  - style.pointerEvents: 'none' — never blocks scroll or tap
 *  - Text color adapts automatically to bubble brightness via
 *    AdaptiveTextColorEngine (dark text on light bubbles, light on dark)
 *  - Inpainting fill is a pixel-sampled color from SmartInpaintingEngine
 *  - memo() — never re-renders unless props change
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { getSafeZone } from "./ArabicTypesettingEngine";
import type { InpaintColor } from "./SmartInpaintingEngine";
import { preserveContourEdges } from "./SmartInpaintingEngine";
import { resolveFromCss } from "./AdaptiveTextColorEngine";

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
  isRTL = true,
}: SkiaOverlayCanvasProps) {
  const INSET = preserveContourEdges(); // = 2 — never bleeds past bubble contour

  const items = useMemo(() => {
    return regions.map((region, idx) => {
      // ── Absolute position from normalised OCR coordinates ────────────────
      // Maps fractional (0–1) bounds directly to the rendered layout rect,
      // completely avoiding the (0,0) origin bug and absolute top floats.
      const left   = region.x * displayW;
      const top    = region.y * displayH;
      const width  = region.w * displayW;
      const height = region.h * displayH;

      if (width < 12 || height < 10) return null;

      const text = region.translated?.trim();
      if (!text) return null;

      const isSFX      = region.type === "sfx";
      const isThought  = region.type === "thought";

      // ── Typography layout ─────────────────────────────────────────────────
      const { safeW } = getSafeZone(width, height);
      const typeset = isSFX
        ? scaleSFXFont(text, width, height)
        : scaleFontToFit(text, width, height);

      const renderedText = typeset.lines.join("\n");

      // ── Inpaint fill (pixel-sampled or Gemini-supplied bgColor fallback) ──
      const inpaint    = inpaintColors[idx];
      const inpaintCss = inpaint?.css ?? region.bgColor ?? "rgb(245,245,240)";

      // ── Adaptive text color: luminance-driven, never hardcoded ────────────
      const colorProfile = resolveFromCss(inpaintCss);

      return {
        key: idx,
        left,
        top,
        width,
        height,
        inpaintCss,
        safeW,
        typeset,
        renderedText,
        colorProfile,
        isSFX,
        isThought,
      };
    }).filter(Boolean);
  }, [regions, displayW, displayH, inpaintColors, isRTL]);

  return (
    <View style={[styles.canvasRoot, { pointerEvents: "none" }]}>
      {items.map((item) => {
        if (!item) return null;
        const {
          key,
          left,
          top,
          width,
          height,
          inpaintCss,
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
              { left, top, width, height, pointerEvents: "none" },
            ]}
          >
            {/* ── Inpainting layer ─────────────────────────────────────────
                Pixel-matched fill derived from the manga bitmap.
                NOT a white box — color comes from the bubble's own pixels.
                Inset by INSET px on all sides: never crosses bubble contour. */}
            <View
              style={[
                styles.inpaintLayer,
                {
                  backgroundColor: inpaintCss,
                  top: INSET,
                  left: INSET,
                  right: INSET,
                  bottom: INSET,
                  pointerEvents: "none",
                },
              ]}
            />

            {/* ── Typography layer — ONLY the Arabic text, no background ─── */}
            <View style={[styles.textLayer, { pointerEvents: "none" }]}>
              <Text
                style={[
                  styles.arabicText,
                  {
                    fontSize: typeset.fontSize,
                    lineHeight: typeset.lineHeight,
                    // Adaptive: dark on light bubble, light on dark panel
                    color: colorProfile.color,
                    fontWeight: isSFX ? "900" : "700",
                    fontStyle: isThought ? "italic" : "normal",
                    textAlign: "center",
                    writingDirection: "rtl",
                    letterSpacing: isSFX ? 0.5 : 0,
                    // Luminance-driven subtle shadow for readability
                    ...Platform.select({
                      web: {
                        textShadow: `0px 0px ${colorProfile.shadowRadius}px ${colorProfile.shadowColor}`,
                      },
                      default: {
                        textShadowColor: colorProfile.shadowColor,
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
    overflow: "hidden",
  },
  inpaintLayer: {
    position: "absolute",
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
