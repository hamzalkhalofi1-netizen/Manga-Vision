/**
 * SkiaOverlayCanvas — Professional manga scanlation renderer.
 *
 * ── Architecture (Koharu-inspired) ──────────────────────────────────────────
 *
 * Two independent geometry layers:
 *   MASK layer   → original glyph polygon  (covers ink exactly)
 *   LAYOUT layer → bubble-estimated area   (BUBBLE_LAYOUT_SCALE × polygon)
 *
 * ── Mask shape ──────────────────────────────────────────────────────────────
 *
 * Each mask layer uses a SMOOTH BEZIER PATH (quadratic midpoint-bezier) rather
 * than a strict polygon.  The midpoint-bezier technique rounds every corner so
 * the mask silhouette matches the natural balloon shape of a manga speech
 * bubble rather than a hard-edged quadrilateral.
 *
 * ── Color system ────────────────────────────────────────────────────────────
 *
 * Per-region mask color priority (highest first):
 *   1. Real pixel sample — BubbleColorSampler reads actual image pixels at the
 *      polygon centroid + 4 inner offsets (web + CORS only).
 *   2. Gemini bgColor — AI-sampled bubble fill color from the OCR model.
 *      Primary source on native / CORS-blocked web.
 *
 * ── Adaptive opacity ─────────────────────────────────────────────────────────
 *
 * Halo and mid-ring opacities are scaled by the effective mask color luminance:
 *   Light bubbles (lum > 0.85) → fainter halos
 *   Dark bubbles  (lum < 0.25) → stronger halos
 *   Mid-tone                   → standard values
 *
 * ── Region filtering ─────────────────────────────────────────────────────────
 *
 * Client-side heuristics suppress non-bubble content that Gemini occasionally
 * includes: UI overlays, subtitle banners, credits, watermarks, tiny decorations.
 * These are detected by geometry: abnormal aspect ratios, page-edge position,
 * excessive width, or sub-threshold area.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
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
  /** Full URL of the manga page image — used for per-region pixel color sampling. */
  imageUri?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * BUBBLE_LAYOUT_SCALE — text container expansion factor beyond the glyph polygon.
 *
 * Gemini's OCR polygon is glyph-tight.  Speech bubbles are ~1.3–1.5× larger
 * than their text column.  1.35 is the midpoint.  Applies to TEXT CONTAINER
 * and font sizing only — SVG mask polygons always use original coordinates.
 */
const BUBBLE_LAYOUT_SCALE = 1.35;

/**
 * CORE_EXPAND — core mask expansion in pixels.
 *
 * 8 px covers anti-aliased glyph fringe + any slight OCR polygon registration
 * error.  Larger than the previous 4 px to ensure ink is fully hidden even
 * when the Gemini polygon clips the descenders or stroke tails.
 */
const CORE_EXPAND = 8;

// ── Region filtering ──────────────────────────────────────────────────────────

/**
 * shouldRenderRegion — client-side heuristic filter.
 *
 * Suppresses non-bubble content that Gemini occasionally returns:
 *   • UI/HUD overlays       — very wide relative to displayW
 *   • Subtitle banners      — wide + short (subtitle aspect ratio)
 *   • Watermarks/credits    — positioned at extreme page edges
 *   • Tiny decorations      — below minimum readable area
 *   • Partial cropped text  — clipped at page borders
 *
 * These heuristics are CONSERVATIVE — a real bubble will never fail all
 * thresholds simultaneously.  When in doubt, we render (false negative is
 * invisible original text; false positive from filtering is lost translation).
 */
function shouldRenderRegion(
  region: TextRegion,
  displayW: number,
  displayH: number,
): boolean {
  const text = region.translated?.trim();
  if (!text) return false;

  const regionW   = region.w * displayW;
  const regionH   = region.h * displayH;
  const regionTop = region.y * displayH;
  const regionBot = (region.y + region.h) * displayH;

  // ── Minimum area — anything below this is noise, not a readable bubble
  if (regionW < 22 || regionH < 16)        return false;
  if (regionW * regionH < 600)             return false;   // < ~25×24 px

  // ── Width cap — real speech bubbles do not span more than 62% of the page.
  //    Wider regions are UI overlays, chapter banners, or subtitle strips.
  if (regionW > displayW * 0.62)           return false;

  // ── Subtitle / banner detection — very wide AND very short.
  //    Aspect ratio > 4.5 with height < 55 px is a subtitle-like geometry.
  const aspectRatio = regionW / Math.max(regionH, 1);
  if (aspectRatio > 4.5 && regionH < 55)  return false;

  // ── Page-edge suppression.
  //    Thin strips at the very top or bottom are chapter/page numbers or credits.
  const isTopStrip    = regionTop < displayH * 0.025 && regionH < displayH * 0.04;
  const isBottomStrip = regionBot > displayH * 0.975 && regionH < displayH * 0.04;
  if (isTopStrip || isBottomStrip)         return false;

  // ── Sign / title regions at extreme page edges are usually decorative labels
  //    or UI elements, not translatable dialogue.
  if (
    (region.type === "sign" || region.type === "title") &&
    (regionTop < displayH * 0.04 || regionBot > displayH * 0.96) &&
    (region.translated?.split(/\s+/).length ?? 0) <= 1
  ) {
    return false;
  }

  return true;
}

// ── Polygon geometry ──────────────────────────────────────────────────────────

function polygonCentroid(pts: [number, number][]): { x: number; y: number } {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n < 3)   return { x: (pts[0][0] + pts[n-1][0]) / 2, y: (pts[0][1] + pts[n-1][1]) / 2 };

  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross     = x0 * y1 - x1 * y0;
    area += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 0.5) {
    return {
      x: pts.reduce((s, [x]) => s + x, 0) / n,
      y: pts.reduce((s, [, y]) => s + y, 0) / n,
    };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function expandPolygon(
  pts: [number, number][],
  cx: number, cy: number, px: number,
): [number, number][] {
  return pts.map(([x, y]) => {
    const dx   = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) return [x, y] as [number, number];
    return [x + (dx / dist) * px, y + (dy / dist) * px] as [number, number];
  });
}

/**
 * polygonToSmoothPath — converts polygon points to a smooth SVG path.
 *
 * Uses the midpoint-bezier technique:
 *   1. Compute the midpoint M[i] between each consecutive pair of vertices.
 *   2. Move to M[0].
 *   3. For each vertex V[i], draw a quadratic bezier:
 *      control point = V[i], end point = M[(i+1) % n].
 *
 * This rounds every corner of the polygon, transforming a quadrilateral into
 * a smooth balloon shape that visually matches manga speech bubble silhouettes.
 * No additional expand needed — the rounding itself naturally softens edges.
 */
function polygonToSmoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 3) return "";

  const mids: [number, number][] = pts.map((pt, i) => {
    const next = pts[(i + 1) % n];
    return [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2] as [number, number];
  });

  let d = `M ${mids[0][0].toFixed(2)} ${mids[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const [cx, cy]   = pts[i];
    const [ex, ey]   = mids[(i + 1) % n];
    d += ` Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  }
  d += " Z";
  return d;
}

function polygonRotationDeg(pts: [number, number][]): number {
  if (pts.length < 2) return 0;
  const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1];
  let deg  = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg >  90) deg -= 180;
  if (deg < -90) deg += 180;
  deg = Math.max(-30, Math.min(30, deg));
  return Math.abs(deg) < 2 ? 0 : Math.round(deg * 10) / 10;
}

function polygonDimensions(
  pts: [number, number][],
  cx: number, cy: number, rotDeg: number,
): { w: number; h: number } {
  const angle   = rotDeg * (Math.PI / 180);
  const cosA    = Math.cos(-angle), sinA = Math.sin(-angle);
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
  const n    = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbStringToRgb(s: string): Rgb | null {
  const m = s.match(/\d+/g);
  if (!m || m.length < 3) return null;
  return { r: +m[0], g: +m[1], b: +m[2] };
}

function parseColor(color: string): Rgb {
  if (!color) return { r: 245, g: 242, b: 235 };
  const t = color.trim();
  if (t.startsWith("#"))   return hexToRgb(t)       ?? { r: 245, g: 242, b: 235 };
  if (t.startsWith("rgb")) return rgbStringToRgb(t)  ?? { r: 245, g: 242, b: 235 };
  return { r: 245, g: 242, b: 235 };
}

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

function adaptiveMaskOpacity(lum: number): MaskOpacity {
  if (lum > 0.85) {
    return { haloFill: 0.06, haloStroke: 0.03, midFill: 0.30, midStroke: 0.12 };
  }
  if (lum < 0.25) {
    return { haloFill: 0.16, haloStroke: 0.09, midFill: 0.52, midStroke: 0.22 };
  }
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
    const rotDeg            = region.rotation ?? polygonRotationDeg(absolutePts);
    const { w: ocrW, h: ocrH } = polygonDimensions(absolutePts, cx, cy, rotDeg);
    if (ocrW < 8 || ocrH < 6) return null;
    return {
      cx, cy, ocrW, ocrH,
      layoutW: ocrW * BUBBLE_LAYOUT_SCALE,
      layoutH: ocrH * BUBBLE_LAYOUT_SCALE,
      absolutePts, rotDeg,
    };
  }

  const ocrW    = region.w * displayW;
  const ocrH    = region.h * displayH;
  const cx      = (region.centroid?.x ?? region.x + region.w / 2) * displayW;
  const cy      = (region.centroid?.y ?? region.y + region.h / 2) * displayH;
  const rotDeg  = region.rotation ?? 0;
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

// ── Component ─────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH, imageUri }: Props) {
  // Per-region pixel sampling (web + CORS only, async, falls back to Gemini bgColor)
  const colorMap = useRegionColors(imageUri, regions);

  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        // ── Filter non-bubble content ─────────────────────────────────────
        if (!shouldRenderRegion(region, displayW, displayH)) return null;

        const text = region.translated?.trim();
        if (!text) return null;

        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;
        const { cx, cy, ocrW, ocrH, layoutW, layoutH, absolutePts, rotDeg } = placement;

        const isSFX       = region.type === "sfx";
        const isThought   = region.type === "thought";
        const isNarration = region.type === "narration" || region.type === "sign";

        // ── Font scaling against estimated bubble area ────────────────────
        const typeset = isSFX
          ? scaleSFXFont(text, layoutW, layoutH)
          : scaleFontToFit(text, layoutW, layoutH);
        if (typeset.lines.length === 0) return null;

        // ── Effective mask color ──────────────────────────────────────────
        const sampledColor  = colorMap.get(idx);
        const effectiveRgb: Rgb = sampledColor
          ? { r: sampledColor.r, g: sampledColor.g, b: sampledColor.b }
          : parseColor(region.bgColor ?? "#f5f2eb");

        const { r, g, b } = effectiveRgb;
        const lum           = rgbLuminance(r, g, b);
        const colorStr      = `rgb(${r},${g},${b})`;
        const strokeStr     = `rgba(${r},${g},${b},0.28)`;

        // ── Adaptive mask opacity ─────────────────────────────────────────
        const opacity = adaptiveMaskOpacity(lum);

        // ── Three-layer mask geometry (glyph-tight coordinates) ───────────
        //
        // Expansion amounts stay in pixels (same as before) but each layer
        // is now rendered as a smooth bezier path instead of a sharp polygon.
        // This rounds the corners to naturally match speech bubble silhouettes.
        const haloExpand = Math.max(6, Math.min(14, ocrW * 0.09));
        const midExpand  = haloExpand * 0.55;

        const haloPath = polygonToSmoothPath(expandPolygon(absolutePts, cx, cy, haloExpand));
        const midPath  = polygonToSmoothPath(expandPolygon(absolutePts, cx, cy, midExpand));
        const corePath = polygonToSmoothPath(expandPolygon(absolutePts, cx, cy, CORE_EXPAND));

        // ── Text color ────────────────────────────────────────────────────
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        const shadowRadius = isNarration
          ? Math.max(colorProfile.shadowRadius, 2.0)
          : colorProfile.shadowRadius;

        return {
          key: idx,
          cx, cy, layoutW, layoutH,
          haloPath, midPath, corePath,
          maskColor:   colorStr,
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
       * ── Layer 1: Three-layer smooth mask ─────────────────────────────────
       *
       * All halos rendered first, then all mids, then all cores — prevents
       * halo-of-A overlapping core-of-B across adjacent regions.
       *
       * Each layer uses a smooth bezier path (polygonToSmoothPath) so corners
       * are rounded naturally.  This eliminates the white-rectangle appearance.
       */}
      <Svg width={displayW} height={displayH} style={StyleSheet.absoluteFillObject}>

        {/* 1a — Halo: widest, most transparent, smoothly rounded */}
        {items.map((item) => item && (
          <Path
            key={`halo-${item.key}`}
            d={item.haloPath}
            fill={item.maskColor}
            fillOpacity={item.opacity.haloFill}
            stroke={item.maskColor}
            strokeWidth={16}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeOpacity={item.opacity.haloStroke}
          />
        ))}

        {/* 1b — Mid: intermediate feather ring */}
        {items.map((item) => item && (
          <Path
            key={`mid-${item.key}`}
            d={item.midPath}
            fill={item.maskColor}
            fillOpacity={item.opacity.midFill}
            stroke={item.maskColor}
            strokeWidth={7}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeOpacity={item.opacity.midStroke}
          />
        ))}

        {/* 1c — Core: fully hides original ink */}
        {items.map((item) => item && (
          <Path
            key={`core-${item.key}`}
            d={item.corePath}
            fill={item.maskColor}
            fillOpacity={1}
            stroke={item.strokeColor}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

      </Svg>

      {/*
       * ── Layer 2: Arabic text ─────────────────────────────────────────────
       *
       * Container = layoutW × layoutH (estimated bubble, NOT glyph bounds).
       * Centered on the polygon centroid (cx, cy).
       * overflow: "hidden" — text clips at the container boundary rather than
       * bleeding into adjacent panels if the hard floor is hit.
       */}
      {items.map((item) => {
        if (!item) return null;
        const {
          key, cx, cy, layoutW, layoutH,
          typeset, renderedText, colorProfile, rotDeg, isSFX, isThought,
        } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                left:     cx - layoutW / 2,
                top:      cy - layoutH / 2,
                width:    layoutW,
                height:   layoutH,
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
    overflow:        "hidden",   // Clip at container boundary — prevents panel bleed
  },
  label: {
    includeFontPadding: false,
    textAlignVertical:  "center",
    textAlign:          "center",
    writingDirection:   "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
