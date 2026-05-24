/**
 * SkiaOverlayCanvas — professional visual mask + text overlay system.
 *
 * Layer order per OCR region:
 *   1. Adaptive mask  — rounded rect, color sampled from Gemini bgColor,
 *                       padded beyond the glyph edge, soft shadow border.
 *   2. Arabic text    — centered, auto-fitted, \n split, RTL, text-shadow.
 *
 * No OpenCV. No server inpaint calls. No fixed colors.
 * Everything runs 100% on-device in TypeScript/React Native.
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

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

/**
 * Derive an adaptive mask colour from the region's background colour.
 *   Bright background → near-white  rgba(255,255,255, 0.96)
 *   Dark  background  → near-black  rgba(10,15,30,    0.94)
 * Tinted to match the actual background rather than a fixed white.
 */
function adaptiveMaskColor(bgColor: string): string {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return "rgba(255,255,255,0.96)";

  // Perceptual luminance (BT.601)
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;

  if (lum > 0.5) {
    // Light background — boost slightly toward pure white, keep tint
    const r = Math.min(255, Math.round(rgb.r * 0.15 + 217));
    const g = Math.min(255, Math.round(rgb.g * 0.15 + 217));
    const b = Math.min(255, Math.round(rgb.b * 0.15 + 217));
    return `rgba(${r},${g},${b},0.96)`;
  } else {
    // Dark background — pull toward near-black, keep tint
    const r = Math.max(0, Math.round(rgb.r * 0.2 + 8));
    const g = Math.max(0, Math.round(rgb.g * 0.2 + 10));
    const b = Math.max(0, Math.round(rgb.b * 0.2 + 20));
    return `rgba(${r},${g},${b},0.94)`;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH }: SkiaOverlayCanvasProps) {

  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        // ── Display-space bbox ──────────────────────────────────────────────
        const bboxW = region.w * displayW;
        const bboxH = region.h * displayH;
        if (bboxW < 12 || bboxH < 10) return null;

        const text = region.translated?.trim();
        if (!text) return null;

        // ── Exact center in display-space pixels ────────────────────────────
        const cx = (region.centerX ?? region.x + region.w / 2) * displayW;
        const cy = (region.centerY ?? region.y + region.h / 2) * displayH;

        // ── Region type flags ───────────────────────────────────────────────
        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // ── Typography ──────────────────────────────────────────────────────
        const typeset = isSFX
          ? scaleSFXFont(text, bboxW, bboxH)
          : scaleFontToFit(text, bboxW, bboxH);

        const renderedText = typeset.lines.join("\n");
        const fontSize = typeset.fontSize;

        // ── Mask padding tied to font size ──────────────────────────────────
        // paddingX = fontSize × 0.8   paddingY = fontSize × 0.45
        const padX = Math.ceil(fontSize * 0.8);
        const padY = Math.ceil(fontSize * 0.45);

        // ── Mask geometry (clamped to display bounds) ───────────────────────
        const rawLeft = cx - bboxW / 2 - padX;
        const rawTop  = cy - bboxH / 2 - padY;
        const rawW    = bboxW + padX * 2;
        const rawH    = bboxH + padY * 2;

        const maskLeft = Math.max(0, rawLeft);
        const maskTop  = Math.max(0, rawTop);
        const maskW    = Math.min(displayW - maskLeft, rawW - (maskLeft - rawLeft));
        const maskH    = Math.min(displayH - maskTop,  rawH - (maskTop  - rawTop));

        if (maskW < 4 || maskH < 4) return null;

        // Adaptive corner radius — proportional, max 10
        const borderRadius = Math.min(10, maskH * 0.22);

        // ── Mask colour — adaptive from Gemini-supplied bgColor ─────────────
        const maskColor = adaptiveMaskColor(region.bgColor ?? "#ffffff");

        // ── Text color ──────────────────────────────────────────────────────
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          cx, cy,
          bboxW, bboxH,
          maskLeft, maskTop, maskW, maskH, borderRadius,
          maskColor,
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
          cx, cy,
          bboxW, bboxH,
          maskLeft, maskTop, maskW, maskH, borderRadius,
          maskColor,
          typeset,
          renderedText,
          colorProfile,
          isSFX,
          isThought,
        } = item;

        return (
          <React.Fragment key={key}>
            {/* ── Layer 1: adaptive mask ────────────────────────────────── */}
            <View
              style={[
                styles.maskBase,
                {
                  left:         maskLeft,
                  top:          maskTop,
                  width:        maskW,
                  height:       maskH,
                  borderRadius,
                  backgroundColor: maskColor,
                  ...Platform.select({
                    ios: {
                      shadowColor:  "rgba(0,0,0,0.18)",
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 1,
                      shadowRadius:  2.5,
                    },
                    android: { elevation: 2 },
                    web: {
                      boxShadow: "0 0 2.5px rgba(0,0,0,0.18)",
                      filter:    "blur(0.4px)",
                    } as any,
                    default: {},
                  }),
                },
              ]}
            />

            {/* ── Layer 2: Arabic translated text ──────────────────────── */}
            <View
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
                    fontSize:      typeset.fontSize,
                    lineHeight:    typeset.lineHeight,
                    color:         colorProfile.color,
                    fontWeight:    isSFX ? "900" : "700",
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
  canvasRoot: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "transparent",
  },
  maskBase: {
    position:        "absolute",
    overflow:        "hidden",
    backgroundColor: "transparent",
  },
  textContainer: {
    position:        "absolute",
    backgroundColor: "transparent",
    justifyContent:  "center",
    alignItems:      "center",
    overflow:        "hidden",
  },
  translatedText: {
    includeFontPadding:  false,
    textAlignVertical:   "center",
    textAlign:           "center",
    writingDirection:    "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
