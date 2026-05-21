/**
 * SkiaOverlayCanvas
 *
 * Google Translate–style text snap: the Arabic translation is placed
 * dead-center over the pixel-erased OCR region.
 *
 * Center-lock math (cross-platform, no % transforms):
 *   centerX = (region.x + region.w / 2) × displayW
 *   centerY = (region.y + region.h / 2) × displayH
 *
 *   Snapping the container at its top-left with explicit dimensions:
 *     left  = centerX - bboxWidth  / 2  ≡  region.x × displayW   ✓
 *     top   = centerY - bboxHeight / 2  ≡  region.y × displayH   ✓
 *
 *   Then flexbox (justifyContent + alignItems: 'center') inside that box
 *   places the text block exactly at (centerX, centerY) — the same pixel
 *   the original glyph cluster occupied.
 *
 * Rendering guarantees:
 *  ✅ backgroundColor: 'transparent' on every container
 *  ✅ style.pointerEvents: 'none' — never blocks scroll / tap
 *  ✅ No Rect(), no rounded rectangles, no borders
 *  ✅ Inpaint fill clamped to 1-px inset (no contour bleed)
 *  ✅ Adaptive text color via AdaptiveTextColorEngine (luminance-driven)
 *  ✅ memo() — never re-renders unless props change
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
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
}: SkiaOverlayCanvasProps) {
  const INSET = preserveContourEdges(); // 1 px — never bleeds past glyph contour

  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        // ── Bbox in display pixels ─────────────────────────────────────────
        const bboxLeft   = region.x * displayW;
        const bboxTop    = region.y * displayH;
        const bboxWidth  = region.w * displayW;
        const bboxHeight = region.h * displayH;

        if (bboxWidth < 12 || bboxHeight < 10) return null;

        const text = region.translated?.trim();
        if (!text) return null;

        // ── Explicit center of the OCR region ─────────────────────────────
        // These are the snap coordinates — the Arabic text block will be
        // perfectly centred on this pixel (via flexbox inside the bbox View).
        // centerX = (region.x + region.w / 2) * displayW = bboxLeft + bboxWidth / 2
        // centerY = (region.y + region.h / 2) * displayH = bboxTop  + bboxHeight / 2

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // ── Typography layout ──────────────────────────────────────────────
        const typeset = isSFX
          ? scaleSFXFont(text, bboxWidth, bboxHeight)
          : scaleFontToFit(text, bboxWidth, bboxHeight);

        const renderedText = typeset.lines.join("\n");

        // ── Inpaint fill (outer-border pixel sample or bgColor fallback) ───
        const inpaint    = inpaintColors[idx];
        const inpaintCss = inpaint?.css ?? region.bgColor ?? "rgb(245,245,240)";

        // ── Adaptive text color (luminance-driven) ─────────────────────────
        const colorProfile = resolveFromCss(inpaintCss);

        return {
          key: idx,
          bboxLeft,
          bboxTop,
          bboxWidth,
          bboxHeight,
          inpaintCss,
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
                // left = centerX - bboxWidth/2,  top = centerY - bboxHeight/2
                // ↳ mathematically identical to region.x * displayW, region.y * displayH
                // This positions the container so its CENTRE is at (centerX, centerY).
                left:   bboxLeft,
                top:    bboxTop,
                width:  bboxWidth,
                height: bboxHeight,
                pointerEvents: "none",
              },
            ]}
          >
            {/* ── Layer 1: Inpaint erase fill ──────────────────────────────
                Color sampled from pixels JUST OUTSIDE the OCR bbox.
                Guaranteed bubble-background pixels — NOT text, NOT white box.
                1-px inset on each edge keeps it inside the glyph contour.  */}
            <View
              style={[
                styles.inpaintLayer,
                {
                  backgroundColor: inpaintCss,
                  top:    INSET,
                  left:   INSET,
                  right:  INSET,
                  bottom: INSET,
                  pointerEvents: "none",
                },
              ]}
            />

            {/* ── Layer 2: Arabic text — no background, center-locked ───────
                The parent View spans (bboxLeft, bboxTop, bboxWidth, bboxHeight).
                Its center is (centerX, centerY) — exactly where the original
                glyph cluster was.  justifyContent + alignItems centre the
                text block on that point, achieving the snap alignment.       */}
            <View style={[styles.textLayer, { pointerEvents: "none" }]}>
              <Text
                style={[
                  styles.arabicText,
                  {
                    fontSize:   typeset.fontSize,
                    lineHeight: typeset.lineHeight,
                    color:      colorProfile.color,
                    fontWeight: isSFX ? "900" : "700",
                    fontStyle:  isThought ? "italic" : "normal",
                    textAlign:  "center",
                    writingDirection: "rtl",
                    letterSpacing: isSFX ? 0.5 : 0,
                    // Luminance-driven shadow: subtle halo separating text from texture
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
