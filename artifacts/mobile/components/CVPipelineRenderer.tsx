/**
 * CVPipelineRenderer
 *
 * Production-grade manga localization renderer powered by the server-side
 * computer-vision pipeline.
 *
 * Architecture:
 *   • The manga page image has already been inpainted by the server:
 *     all original text glyphs have been reconstructed back to the surrounding
 *     bubble background using OpenCV Telea inpainting.
 *   • This renderer ONLY positions translated text inside cleaned bubbles.
 *     No erase layer. No opacity fill. No SVG overlay tricks.
 *
 * Pipeline before render:
 *   1. TextClassificationEngine.classifyRegion() — filter chapter titles,
 *      credits, watermarks, and unknowns. Only speech_bubble, narration_box,
 *      and ui_text reach the render stage.
 *   2. LayoutAnalysisEngine.analyseLayout() — assigns manga reading order
 *      (right-to-left). Rendered regions are sorted in reading order.
 *   3. BubbleDetectionEngine.selectBubblePolygon() — picks the best polygon
 *      (CV contour > Gemini bubble > expanded OCR fallback).
 *   4. polygonAABB() — axis-aligned bounding box in display pixels.
 *   5. ArabicLayoutEngine.layoutText() — type-aware font scaling, line
 *      breaking, tashkeel compensation, bidi direction.
 *
 * Rendering model:
 *   One absolutely-positioned <View> per region, centred within the bubble AABB.
 *   Styling varies by text class:
 *     speech_bubble  → white/black text, standard weight
 *     narration_box  → slightly wider letter-spacing, editorial margin
 *     ui_text        → same as speech, smaller safe zone
 *
 * Renderer never guesses positions. Renderer never creates geometry.
 * Renderer receives bubble polygon, layout data, and only renders.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import {
  selectBubblePolygon,
  polygonAABB,
} from "./cv/BubbleDetectionEngine";
import {
  layoutText,
  ARABIC_FONT_FAMILY,
  type RegionType,
} from "./cv/ArabicLayoutEngine";
import type { CvRefinedRegion } from "./cv/InpaintingEngine";
import { resolveFromCss } from "./AdaptiveTextColorEngine";
import {
  classifyRegion,
  type TextClass,
} from "./cv/TextClassificationEngine";
import { analyseLayout } from "./cv/LayoutAnalysisEngine";
import { DEFAULT_FONT_SETTINGS, useSettings } from "@/context/SettingsContext";

interface Props {
  regions: TextRegion[];
  refinedRegions: (CvRefinedRegion | null)[];
  displayW: number;
  displayH: number;
}

interface RenderedItem {
  key: number;
  readingOrder: number;
  x: number;
  y: number;
  w: number;
  h: number;
  layout: ReturnType<typeof layoutText>;
  text: string;
  color: string;
  shadowColor: string;
  shadowRadius: number;
  textClass: TextClass;
}

const MIN_BUBBLE_PX = 18;
const MIN_BUBBLE_PX_H = 14;
const MIN_AREA_PX = 400;

/**
 * Map canonical TextClass to ArabicLayoutEngine region type.
 */
function toLayoutType(cls: TextClass, geminiType: string): RegionType {
  if (cls === "narration_box") return "narration";
  if (cls === "sfx") return "sfx";
  if (cls === "ui_text") return "sign";
  const g = geminiType.toLowerCase();
  if (g === "thought") return "thought";
  if (g === "sfx") return "sfx";
  if (g === "sign") return "sign";
  if (g === "narration") return "narration";
  return "speech";
}

function CVPipelineRenderer({
  regions,
  refinedRegions,
  displayW,
  displayH,
}: Props) {
  const { fontSettings } = useSettings();
  const fontFamily = fontSettings.fontFamily === "inter"
    ? "Inter"
    : fontSettings.fontFamily === "monospace"
      ? "monospace"
      : ARABIC_FONT_FAMILY;
  const items = useMemo<RenderedItem[]>(() => {
    // ── Phase 1: Classify and filter regions ─────────────────────────────────
    const renderableIndices: number[] = [];
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      const text = region.translated?.trim();
      if (!text) continue;

      const cls = classifyRegion(region);
      if (!cls.shouldRender) continue;

      renderableIndices.push(i);
    }

    if (!renderableIndices.length) return [];

    // ── Phase 2: Assign manga reading order ───────────────────────────────
    const renderableRegions = renderableIndices.map((i) => regions[i]);
    const layout = analyseLayout(renderableRegions);
    const readingOrderByLocal = new Map<number, number>();
    for (const ann of layout.annotations) {
      readingOrderByLocal.set(ann.index, ann.readingOrder);
    }

    // ── Phase 3: Build render items ───────────────────────────────────────
    const result: RenderedItem[] = [];

    for (let localIdx = 0; localIdx < renderableIndices.length; localIdx++) {
      const originalIdx = renderableIndices[localIdx];
      const region = regions[originalIdx];
      const refined = refinedRegions[originalIdx] ?? null;
      const text = region.translated!.trim();

      const cls = classifyRegion(region);
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
      if (w < MIN_BUBBLE_PX || h < MIN_BUBBLE_PX_H || w * h < MIN_AREA_PX) continue;

      const layoutType = toLayoutType(cls.textClass, region.type ?? "speech");
      const textLayout = layoutText(text, w, h, layoutType);
      if (!textLayout.lines.length) continue;

      const colorProfile = resolveFromCss(region.bgColor || "#ffffff");
      const isSFX = cls.textClass === "sfx" || region.type === "sfx";
      const color = isSFX
        ? "#FFE566"
        : fontSettings.textColor !== DEFAULT_FONT_SETTINGS.textColor
          ? fontSettings.textColor
          : colorProfile.color;
      const shadowColor = isSFX ? "rgba(0,0,0,0.95)" : colorProfile.shadowColor;
      const shadowRadius = isSFX ? 8 : colorProfile.shadowRadius;

      result.push({
        key: originalIdx,
        readingOrder: readingOrderByLocal.get(localIdx) ?? localIdx,
        x,
        y,
        w,
        h,
        layout: textLayout,
        text: textLayout.lines.map((l) => l.text).join("\n"),
        color,
        shadowColor,
        shadowRadius,
        textClass: cls.textClass,
      });
    }

    result.sort((a, b) => a.readingOrder - b.readingOrder);
    return result;
  }, [regions, refinedRegions, displayW, displayH, fontSettings]);

  if (!items.length) return null;

  return (
    <View
      style={[styles.root, { width: displayW, height: displayH }]}
      pointerEvents="none"
    >
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
                  fontSize: Math.max(
                    8,
                    item.layout.fontSize *
                      (fontSettings.fontSize / DEFAULT_FONT_SETTINGS.fontSize),
                  ),
                  lineHeight:
                    item.layout.lineHeight *
                    (fontSettings.lineSpacing / DEFAULT_FONT_SETTINGS.lineSpacing),
                  color: item.color,
                  fontFamily,
                  fontWeight: item.textClass === "sfx" ? "900" : fontSettings.fontWeight,
                  fontStyle: item.layout.fontStyle,
                  letterSpacing: fontSettings.letterSpacing,
                  textAlign: fontSettings.textAlign,
                  writingDirection: item.layout.direction,
                  ...(Platform.OS === "web"
                    ? ({
                        textShadow:
                          !fontSettings.shadow
                            ? "none"
                            : item.textClass === "sfx"
                            ? `0px 0px 4px ${item.shadowColor}, 0px 0px 10px rgba(0,0,0,0.8)`
                            : `0px 0px ${Math.max(fontSettings.outlineThickness, item.shadowRadius)}px ${fontSettings.outlineThickness > 0 ? fontSettings.outlineColor : item.shadowColor}`,
                        WebkitFontSmoothing: "antialiased",
                        direction: item.layout.direction,
                      } as object)
                    : {
                        textShadowColor: fontSettings.shadow
                          ? fontSettings.outlineColor
                          : "transparent",
                        textShadowOffset: { width: 0, height: 0 },
                        textShadowRadius: fontSettings.shadow
                          ? Math.max(fontSettings.outlineThickness, item.shadowRadius)
                          : 0,
                      }),
                },
              ]}
              textBreakStrategy="simple"
              allowFontScaling={false}
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
