/**
 * CVPipelineRenderer
 *
 * Production-grade manga localization renderer powered by the server-side
 * computer-vision pipeline.
 *
 * Architecture:
 *   • The manga page image has already been inpainted by the server:
 *     all original text glyphs have been reconstructed back to their
 *     surrounding bubble background using OpenCV Telea inpainting.
 *   • This renderer only needs to position translated text inside
 *     the cleaned bubble boundaries — no erase layer, no opacity fill,
 *     no SVG overlay tricks.
 *   • Text colour is resolved by AdaptiveTextColorEngine from the
 *     bubble's bgColor field, ensuring WCAG-compliant contrast.
 *   • Arabic / RTL layout is handled by ArabicLayoutEngine which
 *     auto-scales font size, balances lines, and compensates for
 *     tashkeel diacritics.
 *
 * Rendering model:
 *   For each translated region:
 *     1. BubbleDetectionEngine.selectBubblePolygon() — picks the best
 *        polygon (refined contour > Gemini bubble > expanded OCR fallback).
 *     2. polygonAABB() — axis-aligned bounding box in display pixels.
 *     3. layoutText() — font size, wrapped lines, line-height, direction.
 *     4. A single absolutely-positioned <View> + <Text> renders the text
 *        inside the AABB centered container.
 *
 * No SVG. No opacity fills. No erase layer. No renderer patches.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { selectBubblePolygon, polygonAABB } from "./cv/BubbleDetectionEngine";
import { layoutText, ARABIC_FONT_FAMILY, type RegionType } from "./cv/ArabicLayoutEngine";
import type { CvRefinedRegion } from "./cv/InpaintingEngine";
import { resolveFromCss } from "./AdaptiveTextColorEngine";

interface Props {
  regions: TextRegion[];
  refinedRegions: CvRefinedRegion[];
  displayW: number;
  displayH: number;
}

interface RenderedItem {
  key: number;
  x: number;
  y: number;
  w: number;
  h: number;
  layout: ReturnType<typeof layoutText>;
  text: string;
  color: string;
  shadowColor: string;
  shadowRadius: number;
  type: string;
}

const MIN_BUBBLE_W = 18;
const MIN_BUBBLE_H = 14;

function shouldRender(region: TextRegion, displayW: number, displayH: number): boolean {
  const text = region.translated?.trim();
  if (!text) return false;

  const rW = region.w * displayW;
  const rH = region.h * displayH;
  const rTop = region.y * displayH;
  const rBot = (region.y + region.h) * displayH;

  if (rW < 20 || rH < 14) return false;
  if (rW * rH < 500) return false;
  if (rW > displayW * 0.70) return false;

  const aspectRatio = rW / Math.max(rH, 1);
  if (aspectRatio > 5.5 && rH < 45) return false;

  const isTopStrip = rTop < displayH * 0.025 && rH < displayH * 0.04;
  const isBottomStrip = rBot > displayH * 0.975 && rH < displayH * 0.04;
  if (isTopStrip || isBottomStrip) return false;

  return true;
}

function CVPipelineRenderer({ regions, refinedRegions, displayW, displayH }: Props) {
  const items = useMemo<RenderedItem[]>(() => {
    const result: RenderedItem[] = [];

    for (let idx = 0; idx < regions.length; idx++) {
      const region = regions[idx];
      if (!shouldRender(region, displayW, displayH)) continue;

      const text = region.translated?.trim();
      if (!text) continue;

      const refined = refinedRegions[idx] ?? null;

      const bubblePoly = selectBubblePolygon({
        refinedBubblePolygon: refined?.refinedBubblePolygon,
        bubblePolygon: region.bubblePolygon ?? refined?.bubblePolygon,
        polygon: region.polygon,
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
      });

      const { x, y, w, h } = polygonAABB(bubblePoly, displayW, displayH);

      if (w < MIN_BUBBLE_W || h < MIN_BUBBLE_H) continue;

      const regionType = (region.type ?? "speech") as RegionType;
      const layout = layoutText(text, w, h, regionType);
      if (layout.lines.length === 0) continue;

      const colorProfile = resolveFromCss(region.bgColor || "#ffffff");
      const color = regionType === "sfx" ? "#FFE566" : colorProfile.color;
      const shadowColor = regionType === "sfx" ? "rgba(0,0,0,0.95)" : colorProfile.shadowColor;
      const shadowRadius = regionType === "sfx" ? 8 : colorProfile.shadowRadius;

      result.push({
        key: idx,
        x,
        y,
        w,
        h,
        layout,
        text: layout.lines.map((l) => l.text).join("\n"),
        color,
        shadowColor,
        shadowRadius,
        type: regionType,
      });
    }

    return result;
  }, [regions, refinedRegions, displayW, displayH]);

  if (!items.length) return null;

  return (
    <View style={[styles.root, { width: displayW, height: displayH }]}>
      {items.map((item) => {
        const paddingX = (item.w - item.layout.safeW) / 2;
        const paddingY = (item.h - item.layout.safeH) / 2;

        return (
          <View
            key={item.key}
            style={[
              styles.bubble,
              {
                left: item.x + paddingX,
                top: item.y + paddingY,
                width: item.layout.safeW,
                height: item.layout.safeH,
              },
            ]}
          >
            <Text
              style={[
                styles.text,
                {
                  fontSize: item.layout.fontSize,
                  lineHeight: item.layout.lineHeight,
                  color: item.color,
                  fontFamily: ARABIC_FONT_FAMILY,
                  fontWeight: item.layout.fontWeight,
                  fontStyle: item.layout.fontStyle,
                  writingDirection: item.layout.direction,
                  ...Platform.select({
                    web: {
                      textShadow: item.type === "sfx"
                        ? `0px 0px 4px ${item.shadowColor}, 0px 0px 10px rgba(0,0,0,0.8)`
                        : `0px 0px ${item.shadowRadius}px ${item.shadowColor}`,
                      WebkitFontSmoothing: "antialiased",
                      direction: item.layout.direction,
                    } as object,
                  }),
                },
              ]}
              textBreakStrategy="simple"
              allowFontScaling={false}
              numberOfLines={undefined}
            >
              {item.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: "transparent",
    pointerEvents: "none",
  } as object,
  bubble: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  text: {
    textAlign: "center",
    includeFontPadding: false,
  },
});

export default memo(CVPipelineRenderer);
