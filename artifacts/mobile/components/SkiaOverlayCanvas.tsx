/**
 * SkiaOverlayCanvas — lightweight manga overlay renderer.
 *
 * Philosophy:
 *   - Each OCR region is independent. No global merging. No collision shifting.
 *   - Mask covers exactly the OCR bbox + tiny padding. Nothing more.
 *   - Color derived directly from Gemini-supplied bgColor (the actual bubble
 *     background). No adaptive AI manipulation.
 *   - Text centered in the OCR bbox, RTL Arabic, conservative font sizes.
 *
 * Layer order per region:
 *   1. Small rounded-rect mask  (hides original text, preserves bubble art)
 *   2. Translated Arabic text   (centered on OCR bbox)
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";

interface Props {
  regions:  TextRegion[];
  displayW: number;
  displayH: number;
  isRTL?:   boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Derive mask fill from the Gemini-supplied bgColor.
 * Uses the actual background color verbatim — no AI-driven blending.
 * Opacity 0.85–0.90 so the mask blends naturally without covering panel art.
 */
function maskFill(bgColor: string): string {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return "rgba(245,242,235,0.88)";
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const alpha = lum > 0.5 ? 0.90 : 0.85;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

// ── Component ─────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {

  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        // Display-space bbox from normalised OCR coords
        const bboxW = region.w * displayW;
        const bboxH = region.h * displayH;
        if (bboxW < 10 || bboxH < 8) return null;

        // Center anchor
        const cx = (region.centerX ?? region.x + region.w / 2) * displayW;
        const cy = (region.centerY ?? region.y + region.h / 2) * displayH;

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // Conservative font fit within OCR bbox
        const typeset = isSFX
          ? scaleSFXFont(text, bboxW, bboxH)
          : scaleFontToFit(text, bboxW, bboxH);

        // Mask: OCR bbox + 3 px padding on each side (tiny, not expansive)
        const PAD = 3;

        // Mask color from Gemini bgColor — direct, no AI processing
        const fillColor = maskFill(region.bgColor ?? "#f5f5f0");

        // Text color
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          cx, cy,
          bboxW, bboxH,
          PAD,
          fillColor,
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
      {items.map((item) => {
        if (!item) return null;
        const { key, cx, cy, bboxW, bboxH, PAD, fillColor, typeset, renderedText, colorProfile, isSFX, isThought } = item;

        // Mask rect: bbox + uniform padding, centered on OCR center
        const maskL = cx - bboxW / 2 - PAD;
        const maskT = cy - bboxH / 2 - PAD;
        const maskW = bboxW + PAD * 2;
        const maskH = bboxH + PAD * 2;

        // Clamp to display bounds
        const left   = Math.max(0, maskL);
        const top    = Math.max(0, maskT);
        const width  = Math.min(maskW, displayW - left);
        const height = Math.min(maskH, displayH - top);

        const borderRadius = Math.min(6, height * 0.2);

        return (
          <React.Fragment key={key}>

            {/* ── Layer 1: mask — hides original text ─────────────────── */}
            <View
              style={[
                styles.mask,
                {
                  left, top, width, height,
                  borderRadius,
                  backgroundColor: fillColor,
                  ...Platform.select({
                    ios: {
                      shadowColor:   "rgba(0,0,0,0.12)",
                      shadowOffset:  { width: 0, height: 0 },
                      shadowOpacity: 1,
                      shadowRadius:  1.5,
                    },
                    android: { elevation: 1 },
                    web: {
                      boxShadow: "0 0 2px rgba(0,0,0,0.12)",
                      filter:    "blur(0.3px)",
                    } as object,
                    default: {},
                  }),
                },
              ]}
            />

            {/* ── Layer 2: translated Arabic text ─────────────────────── */}
            <View
              style={[
                styles.textBox,
                {
                  left:   cx - bboxW / 2,
                  top:    cy - bboxH / 2,
                  width:  bboxW,
                  height: bboxH,
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
                    fontWeight:    isSFX     ? "900" : "700",
                    fontStyle:     isThought ? "italic" : "normal",
                    letterSpacing: isSFX ? 0.5 : 0,
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

          </React.Fragment>
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
  mask: {
    position: "absolute",
    overflow: "hidden",
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
