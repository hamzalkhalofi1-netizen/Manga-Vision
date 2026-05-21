/**
 * SkiaOverlayCanvas
 *
 * A fully transparent, non-interactive overlay layer that renders ONLY Arabic
 * typography — zero backgrounds, zero borders, zero geometry.
 *
 * Rendering contract:
 *  - backgroundColor: 'transparent' on all containers
 *  - pointerEvents: 'none' — never blocks scroll or tap events
 *  - Only the Text nodes themselves are visible
 *  - memo() wrapped — never re-renders unless regions/dims change
 */

import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { getSafeZone } from "./ArabicTypesettingEngine";
import type { InpaintColor } from "./SmartInpaintingEngine";

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
  const items = useMemo(() => {
    return regions.map((region, idx) => {
      const left   = region.x * displayW;
      const top    = region.y * displayH;
      const width  = region.w * displayW;
      const height = region.h * displayH;

      if (width < 12 || height < 10) return null;

      const text = region.translated?.trim();
      if (!text) return null;

      const isSFX      = region.type === "sfx";
      const isNarration = region.type === "narration";
      const isThought  = region.type === "thought";

      const { safeW } = getSafeZone(width, height);
      const typeset = isSFX
        ? scaleSFXFont(text, width, height)
        : scaleFontToFit(text, width, height);

      const renderedText = typeset.lines.join("\n");

      // Text color from region data (Gemini-supplied), default to near-black
      const textColor = region.textColor || "#111111";

      // Inpaint layer: pixel-matched color sampled from bubble interior
      const inpaint = inpaintColors[idx];
      const inpaintCss = inpaint?.css ?? region.bgColor ?? "rgb(245,245,240)";

      // Inpainting rect inset: 2px max — never bleeds outside bubble contour
      const INSET = 2;

      return {
        key: idx,
        left,
        top,
        width,
        height,
        inpaintCss,
        INSET,
        safeW,
        typeset,
        renderedText,
        textColor,
        isSFX,
        isNarration,
        isThought,
        isRTL,
      };
    }).filter(Boolean);
  }, [regions, displayW, displayH, inpaintColors, isRTL]);

  return (
    <View
      style={[styles.canvasRoot, { pointerEvents: "none" }]}
    >
      {items.map((item) => {
        if (!item) return null;
        const {
          key,
          left,
          top,
          width,
          height,
          inpaintCss,
          INSET,
          typeset,
          renderedText,
          textColor,
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
            {/* ── Inpainting layer: pixel-matched fill, NOT a white box ──── */}
            {/* Covers original source text using the bubble's own background */}
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

            {/* ── Typography layer: ONLY Arabic text, fully transparent bg ── */}
            <View
              style={[styles.textLayer, { pointerEvents: "none" }]}
            >
              <Text
                style={[
                  styles.arabicText,
                  {
                    fontSize: typeset.fontSize,
                    lineHeight: typeset.lineHeight,
                    color: textColor,
                    fontWeight: isSFX || item.isSFX ? "900" : "700",
                    fontStyle: isThought ? "italic" : "normal",
                    textAlign: "center",
                    writingDirection: "rtl",
                    letterSpacing: isSFX ? 0.5 : 0,
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
    borderRadius: 0,
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
    textShadowColor: "rgba(255,255,255,0.35)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1.5,
  },
});

export default memo(SkiaOverlayCanvas);
