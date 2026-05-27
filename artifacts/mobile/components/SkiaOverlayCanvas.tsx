/**
 * SkiaOverlayCanvas — Professional manga scanlation renderer.
 *
 * ── Architecture (Koharu-inspired) ──────────────────────────────────────────
 *
 * Two independent geometry layers:
 *   MASK layer   → original glyph polygon  (covers ink exactly)
 *   LAYOUT layer → bubble-estimated area   (BUBBLE_LAYOUT_SCALE × polygon)
 *
 * ── Color system ────────────────────────────────────────────────────────────
 *
 * Per-region mask color priority (highest first):
 *   1. Real pixel sample — BubbleColorSampler reads actual image pixels at the
 *      polygon centroid + 4 inner offsets, filtered to light/low-sat pixels.
 *      Available on web when the image is CORS-accessible.
 *   2. Gemini bgColor — AI-sampled bubble fill color returned by the OCR model.
 *      The primary color source on native and when CORS blocks pixel access.
 *
 * ── Adaptive opacity ─────────────────────────────────────────────────────────
 *
 * Halo and mid-ring opacities are scaled by the effective mask color's luminance:
 *   Light bubbles (lum > 0.85) → fainter halos   (white-on-panel borders are high contrast;
 *                                                  a light halo is less visible than a bold one)
 *   Dark bubbles  (lum < 0.25) → stronger halos   (dark panels need fuller feather coverage)
 *   Mid-tone                   → standard values
 *
 * ── Mask layers ──────────────────────────────────────────────────────────────
 *   Halo  glyph polygon + haloExpand px  faint fill + faint stroke  → outer soft glow
 *   Mid   glyph polygon + midExpand px   42% fill  + light stroke   → feather zone
 *   Core  glyph polygon + CORE_EXPAND px 100% fill                  → fully hides ink
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon as SvgPolygon } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";
import { useRegionColors } from "./useRegionColors";

interface Props {
  regions:   TextRegion[];
  displayW:  number;
  displayH:  number;
  isRTL?:    boolean;
  /** Full URL of the manga page image — used for pixel-level bubble color sampling. */
  imageUri?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * BUBBLE_LAYOUT_SCALE — text container expansion factor beyond the glyph polygon.
 *
 * Gemini's OCR polygon is glyph-tight (wraps original text characters only).
 * Speech bubbles are ~1.3–1.5× larger than their text column.  1.35 is the
 * midpoint: fills bubbles naturally without risking overflow into adjacent panels.
 *
 * This scale applies to TEXT CONTAINER and font sizing only.
 * SVG mask polygons always use the original glyph-tight coordinates.
 */
const BUBBLE_LAYOUT_SCALE = 1.35;

/** Core mask expansion in pixels — covers anti-aliased glyph fringe. */
const CORE_EXPAND = 4;

// ── Polygon geometry ──────────────────────────────────────────────────────────

function polygonCentroid(pts: [number, number][]): { x: number; y: number } {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n < 3)   return { x: (pts[0][0] + pts[n-1][0]) / 2, y: (pts[0][1] + pts[n-1][1]) / 2 };

  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 0.5) {
    return { x: pts.reduce((s, [x]) => s + x, 0) / n, y: pts.reduce((s, [, y]) => s + y, 0) / n };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function expandPolygon(
  pts: [number, number][],
  cx: number, cy: number, px: number,
): [number, number][] {
  return pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) return [x, y] as [number, number];
    return [x + (dx / dist) * px, y + (dy / dist) * px] as [number, number];
  });
}

function polygonRotationDeg(pts: [number, number][]): number {
  if (pts.length < 2) return 0;
  const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1];
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg >  90) deg -= 180;
  if (deg < -90) deg += 180;
  deg = Math.max(-30, Math.min(30, deg));
  return Math.abs(deg) < 2 ? 0 : Math.round(deg * 10) / 10;
}

function polygonDimensions(
  pts: [number, number][],
  cx: number, cy: number, rotDeg: number,
): { w: number; h: number } {
  const angle = rotDeg * (Math.PI / 180);
  const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
  const us: number[] = [], vs: number[] = [];
  for (const [x, y] of pts) {
    const rx = x - cx, ry = y - cy;
    us.push(rx * cosA - ry * sinA);
    vs.push(rx * sinA + ry * cosA);
  }
  return {
    w: Math.max(Math.max(...us) - Math.min(...us), 8),
    h: Math.max(Math.max(...vs) - Math.min(...vs), 6),
  };
}

// ── Color helpers ─────────────────────────────────────────────────────────────

interface Rgb { r: number; g: number; b: number }

function hexToRgb(hex: string): Rgb | null {
  const h    = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbStringToRgb(s: string): Rgb | null {
  const m = s.match(/\d+/g);
  if (!m || m.length < 3) return null;
  return { r: +m[0], g: +m[1], b: +m[2] };
}

/**
 * parseColor — parses any CSS color string (hex or rgb()) into {r,g,b}.
 * Returns a safe light-bubble default on failure.
 */
function parseColor(color: string): Rgb {
  if (!color) return { r: 245, g: 242, b: 235 };
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) return hexToRgb(trimmed) ?? { r: 245, g: 242, b: 235 };
  if (trimmed.startsWith("rgb")) return rgbStringToRgb(trimmed) ?? { r: 245, g: 242, b: 235 };
  return { r: 245, g: 242, b: 235 };
}

/** WCAG-approximate luminance of an RGB triple. */
function rgbLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ── Adaptive opacity ──────────────────────────────────────────────────────────

interface MaskOpacity {
  haloFill:   number;
  haloStroke: number;
  midFill:    number;
  midStroke:  number;
}

/**
 * adaptiveMaskOpacity — tune halo / mid ring transparency by bubble luminance.
 *
 * Light bubbles sit on dark manga panels.  The bubble→panel transition is a
 * hard black border — a bold feather halo against that border looks worse than
 * a faint one.  Reduce halo opacity for light colors to keep the blend subtle.
 *
 * Dark bubbles need fuller coverage because the background also dark, making
 * the feather rings less perceptible — higher opacity compensates.
 */
function adaptiveMaskOpacity(lum: number): MaskOpacity {
  if (lum > 0.85) {
    // Near-white bubble: very faint halo blends into the white space
    return { haloFill: 0.06, haloStroke: 0.03, midFill: 0.30, midStroke: 0.12 };
  }
  if (lum < 0.25) {
    // Dark bubble / panel: stronger feathering needed
    return { haloFill: 0.16, haloStroke: 0.09, midFill: 0.52, midStroke: 0.22 };
  }
  // Mid-tone (tinted speech bubbles, coloured shojo backgrounds, etc.)
  return { haloFill: 0.10, haloStroke: 0.06, midFill: 0.42, midStroke: 0.18 };
}

// ── Placement ─────────────────────────────────────────────────────────────────

interface Placement {
  cx: number; cy: number;
  ocrW: number; ocrH: number;
  layoutW: number; layoutH: number;
  absolutePts: [number, number][];
  rotDeg: number;
}

function getPlacement(
  region: TextRegion,
  displayW: number,
  displayH: number,
): Placement | null {
  if (region.polygon && region.polygon.length >= 3) {
    const absolutePts = region.polygon.map(
      ([nx, ny]) => [nx * displayW, ny * displayH] as [number, number],
    );
    const centroid = region.centroid
      ? { x: region.centroid.x * displayW, y: region.centroid.y * displayH }
      : polygonCentroid(absolutePts);
    const { x: cx, y: cy } = centroid;
    const rotDeg = region.rotation ?? polygonRotationDeg(absolutePts);
    const { w: ocrW, h: ocrH } = polygonDimensions(absolutePts, cx, cy, rotDeg);
    if (ocrW < 8 || ocrH < 6) return null;
    return {
      cx, cy, ocrW, ocrH,
      layoutW: ocrW * BUBBLE_LAYOUT_SCALE,
      layoutH: ocrH * BUBBLE_LAYOUT_SCALE,
      absolutePts, rotDeg,
    };
  }

  const ocrW   = region.w * displayW;
  const ocrH   = region.h * displayH;
  const cx     = (region.centroid?.x ?? region.x + region.w / 2) * displayW;
  const cy     = (region.centroid?.y ?? region.y + region.h / 2) * displayH;
  const rotDeg = region.rotation ?? 0;
  const hw = ocrW / 2, hh = ocrH / 2;
  const absolutePts: [number, number][] = [
    [cx - hw, cy - hh], [cx + hw, cy - hh],
    [cx + hw, cy + hh], [cx - hw, cy + hh],
  ];
  if (ocrW < 8 || ocrH < 6) return null;
  return {
    cx, cy, ocrW, ocrH,
    layoutW: ocrW * BUBBLE_LAYOUT_SCALE,
    layoutH: ocrH * BUBBLE_LAYOUT_SCALE,
    absolutePts, rotDeg,
  };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function ptsToStr(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

// ── Component ─────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH, imageUri }: Props) {
  // ── Per-region pixel sampling (web only, async) ─────────────────────────────
  //
  // colorMap updates incrementally as each region's color is sampled.
  // On native or when CORS blocks access, values remain null and the
  // Gemini bgColor is used as the primary color source.
  const colorMap = useRegionColors(imageUri, regions);

  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;
        const { cx, cy, ocrW, ocrH, layoutW, layoutH, absolutePts, rotDeg } = placement;

        const isSFX      = region.type === "sfx";
        const isThought  = region.type === "thought";
        const isNarration = region.type === "narration" || region.type === "sign";

        // ── Font scaling against estimated bubble area ──────────────────────
        const typeset = isSFX
          ? scaleSFXFont(text, layoutW, layoutH)
          : scaleFontToFit(text, layoutW, layoutH);
        if (typeset.lines.length === 0) return null;

        // ── Effective mask color ────────────────────────────────────────────
        //
        // Priority:
        //   1. Real pixel sample from BubbleColorSampler (web + CORS)
        //   2. Gemini bgColor (native + CORS-blocked web)
        //
        // Both are parsed to {r,g,b} for luminance-based opacity adaptation.
        const sampledColor = colorMap.get(idx);
        const effectiveRgb: Rgb = sampledColor
          ? { r: sampledColor.r, g: sampledColor.g, b: sampledColor.b }
          : parseColor(region.bgColor ?? "#f5f2eb");

        const { r, g, b } = effectiveRgb;
        const lum         = rgbLuminance(r, g, b);
        const colorStr    = `rgb(${r},${g},${b})`;
        const strokeStr   = `rgba(${r},${g},${b},0.28)`;

        // ── Adaptive mask opacity ───────────────────────────────────────────
        const opacity = adaptiveMaskOpacity(lum);

        // ── Three-layer mask geometry (glyph-tight, NOT layoutW/layoutH) ────
        const haloExpand = Math.max(5, Math.min(11, ocrW * 0.08));
        const midExpand  = haloExpand * 0.55;

        const haloPoints = ptsToStr(expandPolygon(absolutePts, cx, cy, haloExpand));
        const midPoints  = ptsToStr(expandPolygon(absolutePts, cx, cy, midExpand));
        const corePoints = ptsToStr(expandPolygon(absolutePts, cx, cy, CORE_EXPAND));

        // ── Text color ──────────────────────────────────────────────────────
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        const shadowRadius = isNarration
          ? Math.max(colorProfile.shadowRadius, 2.0)
          : colorProfile.shadowRadius;

        return {
          key: idx,
          cx, cy, layoutW, layoutH,
          haloPoints, midPoints, corePoints,
          maskColor: colorStr,
          strokeColor: strokeStr,
          opacity,
          typeset,
          renderedText: typeset.lines.join("\n"),
          colorProfile: { ...colorProfile, shadowRadius },
          rotDeg, isSFX, isThought,
        };
      })
      .filter(Boolean);
  }, [regions, displayW, displayH, colorMap]);

  if (!items.length) return null;

  return (
    <View style={[styles.root, { pointerEvents: "none" }]}>

      {/*
       * ── Layer 1: Three-layer mask ─────────────────────────────────────────
       *
       * Three separate map() passes keep all halos below all mids below all
       * cores across every region — prevents one region's halo from rendering
       * over an adjacent region's solid core.
       *
       * Mask polygons use the ORIGINAL glyph-tight geometry.
       * Opacity is luminance-adapted per region.
       */}
      <Svg width={displayW} height={displayH} style={StyleSheet.absoluteFillObject}>

        {/* 1a — Halo: widest, most transparent */}
        {items.map((item) => item && (
          <SvgPolygon
            key={`halo-${item.key}`}
            points={item.haloPoints}
            fill={item.maskColor}
            fillOpacity={item.opacity.haloFill}
            stroke={item.maskColor}
            strokeWidth={14}
            strokeLinejoin="round"
            strokeOpacity={item.opacity.haloStroke}
          />
        ))}

        {/* 1b — Mid: intermediate feather */}
        {items.map((item) => item && (
          <SvgPolygon
            key={`mid-${item.key}`}
            points={item.midPoints}
            fill={item.maskColor}
            fillOpacity={item.opacity.midFill}
            stroke={item.maskColor}
            strokeWidth={6}
            strokeLinejoin="round"
            strokeOpacity={item.opacity.midStroke}
          />
        ))}

        {/* 1c — Core: fully hides original text */}
        {items.map((item) => item && (
          <SvgPolygon
            key={`core-${item.key}`}
            points={item.corePoints}
            fill={item.maskColor}
            fillOpacity={1}
            stroke={item.strokeColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}

      </Svg>

      {/*
       * ── Layer 2: Arabic text ─────────────────────────────────────────────
       *
       * Container = layoutW × layoutH (estimated bubble, NOT glyph bounds).
       * Centered on the polygon centroid (cx, cy).
       * React Native rotates around view center = (cx, cy) exactly.
       */}
      {items.map((item) => {
        if (!item) return null;
        const { key, cx, cy, layoutW, layoutH, typeset, renderedText, colorProfile, rotDeg, isSFX, isThought } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                left:   cx - layoutW / 2,
                top:    cy - layoutH / 2,
                width:  layoutW,
                height: layoutH,
                transform: rotDeg !== 0 ? [{ rotate: `${rotDeg}deg` }] : undefined,
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
                  fontWeight:    isSFX    ? "900" : "700",
                  fontStyle:     isThought ? "italic" : "normal",
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

// ── Styles ────────────────────────────────────────────────────────────────────

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
    overflow:        "visible",
  },
  label: {
    includeFontPadding: false,
    textAlignVertical:  "center",
    textAlign:          "center",
    writingDirection:   "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
