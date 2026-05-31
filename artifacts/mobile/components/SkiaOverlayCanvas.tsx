/**
 * SkiaOverlayCanvas — Professional manga scanlation renderer.
 *
 * ── Rendering architecture ───────────────────────────────────────────────────
 *
 * Three SVG layers + one React Native text layer per region:
 *
 *   LAYER 1 — ERASE (SVG):
 *     Solid fill at 100% opacity using the bubble's bgColor.
 *     Uses the TIGHT OCR glyph polygon + ERASE_EXPAND_PX (4px).
 *     Removes only the original ink — bubble border and surrounding artwork
 *     are left completely untouched.
 *
 *   LAYER 2 — TEXT BED (SVG):
 *     Solid fill at 92% opacity using bgColor.
 *     Shape: bubblePolygon from Gemini (exact bubble outline) OR OCR polygon
 *     expanded by TEXT_BED_EXPAND_RATIO (20%) when bubblePolygon is absent.
 *     Provides a clean, colour-matched background for the translated text.
 *     For white speech bubbles this fills with white (visually natural).
 *     For dark panels this fills with the panel colour (also natural).
 *     No dark overlay — contrast is achieved by adapting the TEXT colour.
 *     Skipped for SFX regions (sound effects sit directly on the artwork).
 *
 *   LAYER 3 — BORDER (SVG):
 *     Thin contrast stroke (dark for light bubbles, light for dark panels)
 *     at 40–45% opacity tracing the text-bed boundary.
 *     Restores / strengthens the natural bubble outline.
 *     Skipped for SFX. Dashed (4 3) for thought bubbles.
 *
 *   LAYER 4 — TEXT (React Native View + Text):
 *     Colour resolved from bgColor via AdaptiveTextColorEngine.resolveFromCss:
 *       • Light (white) bubble  →  dark text  #1A1A1A
 *       • Dark panel            →  light text #F8F8F8
 *       • SFX                   →  yellow     #FFE566
 *     Subtle halo shadow derived from the same colour profile.
 *     Container: TEXT_SAFE (88%) of the bubble AABB, centered.
 *     overflow: hidden prevents any bleed outside the container.
 *     Font auto-sized 24 → 8 px until all lines fit.
 *     Arabic RTL, centre-aligned, balanced line distribution.
 *
 * ── Bubble polygon source (priority) ────────────────────────────────────────
 *
 *   1. region.bubblePolygon  — Gemini-provided full outline (best accuracy)
 *   2. OCR polygon × 1.20   — moderate expansion fallback (was 1.35)
 *   3. Bounding-box rect × 1.20 — last resort
 *
 * ── Debug ────────────────────────────────────────────────────────────────────
 *
 *   Set DEBUG_OVERLAY = true to draw:
 *   • Red:   bubble polygon (text bed boundary)
 *   • Blue:  OCR glyph polygon (erase boundary)
 *   • Green: text container (safe zone)
 *   • Label: font size + container dimensions
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";
import { resolveFromCss } from "./AdaptiveTextColorEngine";

// ── Debug ─────────────────────────────────────────────────────────────────────

/** Set true to draw polygon outlines and font-size labels. NEVER commit true. */
const DEBUG_OVERLAY = false;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fraction of bubble AABB used for the text container. */
const TEXT_SAFE = 0.88;

/**
 * TEXT_BED_EXPAND_RATIO — when bubblePolygon is absent, expand the OCR polygon
 * by this fraction of its longest span to approximate the speech bubble.
 * 0.20 → text bed ≈ OCR bounds × 1.20 from the centroid.
 * Significantly tighter than the old 0.35 value — preserves more artwork.
 */
const TEXT_BED_EXPAND_RATIO = 0.20;

/** Minimum pixel expansion for the text bed (prevents under-expansion on tiny text). */
const TEXT_BED_EXPAND_MIN_PX = 14;

/**
 * ERASE_EXPAND_PX — extra pixels added to the OCR polygon for the erase fill.
 * Small value (4px) ensures complete glyph coverage without extending into
 * the bubble border or surrounding artwork.
 */
const ERASE_EXPAND_PX = 4;

// ── Region filtering ──────────────────────────────────────────────────────────

/**
 * shouldRenderRegion — client-side heuristic filter.
 *
 * Suppresses non-bubble content: UI overlays, subtitle banners, credits,
 * watermarks, tiny decorations, page-edge strips.
 * Conservative — when in doubt we render.
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

  if (regionW < 20 || regionH < 14)        return false;
  if (regionW * regionH < 500)             return false;
  if (regionW > displayW * 0.70)           return false;

  const aspectRatio = regionW / Math.max(regionH, 1);
  if (aspectRatio > 5.5 && regionH < 45)  return false;

  const isTopStrip    = regionTop < displayH * 0.025 && regionH < displayH * 0.04;
  const isBottomStrip = regionBot > displayH * 0.975 && regionH < displayH * 0.04;
  if (isTopStrip || isBottomStrip)         return false;

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
  if (n < 3)   return { x: (pts[0][0] + pts[n - 1][0]) / 2, y: (pts[0][1] + pts[n - 1][1]) / 2 };

  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
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
 * polygonToSmoothPath — midpoint-bezier rounding.
 *
 * Rounds every vertex of the polygon so the SVG path naturally follows
 * rounded manga bubble shapes (ovals, rounded rectangles).
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
    const [qx, qy] = pts[i];
    const [ex, ey] = mids[(i + 1) % n];
    d += ` Q ${qx.toFixed(2)} ${qy.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
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

// ── Placement ─────────────────────────────────────────────────────────────────

interface Placement {
  /** Centroid of the bubble polygon in display pixels. */
  cx: number; cy: number;
  /** OCR glyph polygon in display pixels — used for the erase layer. */
  ocrPts: [number, number][];
  /** Full bubble polygon in display pixels — used for text bed + border. */
  bubblePts: [number, number][];
  /** Axis-aligned bounding box of the bubble polygon. */
  aabbX: number; aabbY: number;
  aabbW: number; aabbH: number;
  /** Text container = AABB × TEXT_SAFE, centered inside AABB. */
  containerX: number; containerY: number;
  containerW: number; containerH: number;
  /** Rotation angle derived from the OCR polygon dominant axis (degrees). */
  rotDeg: number;
}

function getPlacement(
  region: TextRegion,
  displayW: number,
  displayH: number,
): Placement | null {
  // ── OCR polygon (glyph-tight) ────────────────────────────────────────────────
  let ocrPts: [number, number][];
  if (region.polygon && region.polygon.length >= 3) {
    ocrPts = region.polygon.map(
      ([nx, ny]) => [nx * displayW, ny * displayH] as [number, number],
    );
  } else {
    const ocrW = region.w * displayW;
    const ocrH = region.h * displayH;
    const ocx  = (region.x + region.w / 2) * displayW;
    const ocy  = (region.y + region.h / 2) * displayH;
    ocrPts = [
      [ocx - ocrW / 2, ocy - ocrH / 2],
      [ocx + ocrW / 2, ocy - ocrH / 2],
      [ocx + ocrW / 2, ocy + ocrH / 2],
      [ocx - ocrW / 2, ocy + ocrH / 2],
    ];
  }

  const ocrCentroid = region.centroid
    ? { x: region.centroid.x * displayW, y: region.centroid.y * displayH }
    : polygonCentroid(ocrPts);
  let cx = ocrCentroid.x;
  let cy = ocrCentroid.y;

  // ── Bubble polygon (text bed + border shape) ────────────────────────────────
  //
  // Priority:
  //   1. region.bubblePolygon — Gemini-provided full bubble outline (exact)
  //   2. OCR polygon × TEXT_BED_EXPAND_RATIO — approximate fallback
  let bubblePts: [number, number][];

  if (region.bubblePolygon && region.bubblePolygon.length >= 3) {
    bubblePts = region.bubblePolygon.map(
      ([nx, ny]) => [nx * displayW, ny * displayH] as [number, number],
    );
    // Recompute centroid from the actual bubble outline for accurate text centering
    const bc = polygonCentroid(bubblePts);
    cx = bc.x; cy = bc.y;
  } else {
    const ocrXs    = ocrPts.map((p) => p[0]);
    const ocrYs    = ocrPts.map((p) => p[1]);
    const ocrSpanX = Math.max(...ocrXs) - Math.min(...ocrXs);
    const ocrSpanY = Math.max(...ocrYs) - Math.min(...ocrYs);
    const ocrSpan  = Math.max(ocrSpanX, ocrSpanY);
    const expandPx = Math.max(ocrSpan * TEXT_BED_EXPAND_RATIO, TEXT_BED_EXPAND_MIN_PX);
    bubblePts = expandPolygon(ocrPts, cx, cy, expandPx);
  }

  // ── Bubble AABB ─────────────────────────────────────────────────────────────
  const bxs   = bubblePts.map((p) => p[0]);
  const bys   = bubblePts.map((p) => p[1]);
  const aabbX = Math.max(0, Math.min(...bxs));
  const aabbY = Math.max(0, Math.min(...bys));
  const aabbW = Math.min(displayW - aabbX, Math.max(...bxs) - Math.min(...bxs));
  const aabbH = Math.min(displayH - aabbY, Math.max(...bys) - Math.min(...bys));

  if (aabbW < 16 || aabbH < 12) return null;

  // ── Text container = AABB × TEXT_SAFE, centered ─────────────────────────────
  const containerW = aabbW * TEXT_SAFE;
  const containerH = aabbH * TEXT_SAFE;
  const containerX = aabbX + (aabbW - containerW) / 2;
  const containerY = aabbY + (aabbH - containerH) / 2;

  const rotDeg = region.rotation ?? polygonRotationDeg(ocrPts);

  return {
    cx, cy,
    ocrPts, bubblePts,
    aabbX, aabbY, aabbW, aabbH,
    containerX, containerY, containerW, containerH,
    rotDeg,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  regions:   TextRegion[];
  displayW:  number;
  displayH:  number;
  isRTL?:    boolean;
  imageUri?: string;
}

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        if (!shouldRenderRegion(region, displayW, displayH)) return null;

        const text = region.translated?.trim();
        if (!text) return null;

        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;

        const {
          cx, cy,
          ocrPts, bubblePts,
          aabbX, aabbY, aabbW, aabbH,
          containerX, containerY, containerW, containerH,
          rotDeg,
        } = placement;

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        const typeset = isSFX
          ? scaleSFXFont(text, aabbW, aabbH)
          : scaleFontToFit(text, aabbW, aabbH);
        if (typeset.lines.length === 0) return null;

        const bgColor = region.bgColor || "#ffffff";

        // ── Adaptive text colour from bubble background ──────────────────────
        // Resolves WCAG-compliant contrast colour based on bgColor luminance.
        // Dark text (#1A1A1A) for light/white bubbles.
        // Light text (#F8F8F8) for dark panels and narration boxes.
        const colorProfile = resolveFromCss(bgColor);
        const textColor    = isSFX ? "#FFE566" : colorProfile.color;
        const shadowColor  = isSFX ? "rgba(0,0,0,0.95)" : colorProfile.shadowColor;
        const shadowRadius = isSFX ? 8 : colorProfile.shadowRadius;

        // ── ERASE path: tight OCR polygon + ERASE_EXPAND_PX ─────────────────
        // Removes only the original ink glyphs.
        // Does NOT touch the bubble border or surrounding artwork.
        const erasePts  = expandPolygon(ocrPts, cx, cy, ERASE_EXPAND_PX);
        const erasePath = polygonToSmoothPath(erasePts);

        // ── TEXT BED path: full bubble outline ───────────────────────────────
        // Used as both the background fill (bgColor @ 92%) and the border stroke.
        // When bubblePolygon is from Gemini this is the exact bubble shape.
        const textBedPath = polygonToSmoothPath(bubblePts);

        // ── Border stroke colour ─────────────────────────────────────────────
        // Contrast with bubble fill: dark stroke for light bubbles (restores the
        // natural black bubble outline), light stroke for dark panels.
        const borderStroke    = colorProfile.isDark
          ? "rgba(220,220,220,0.45)"
          : "rgba(20,20,20,0.40)";
        const borderDashArray = isThought ? "4 3" : undefined;

        // Debug paths (no-ops when DEBUG_OVERLAY is false)
        const ocrPath    = DEBUG_OVERLAY ? polygonToSmoothPath(ocrPts) : "";
        const bubblePath = DEBUG_OVERLAY ? polygonToSmoothPath(bubblePts) : "";

        return {
          key: idx,
          erasePath, textBedPath,
          ocrPath, bubblePath,
          bgColor, colorProfile,
          borderStroke, borderDashArray,
          textColor, shadowColor, shadowRadius,
          aabbX, aabbY, aabbW, aabbH,
          containerX, containerY, containerW, containerH,
          typeset,
          renderedText: typeset.lines.join("\n"),
          rotDeg, isSFX, isThought,
        };
      })
      .filter(Boolean);
  }, [regions, displayW, displayH]);

  if (!items.length) return null;

  return (
    <View style={[styles.root, { pointerEvents: "none" }]}>

      {/*
       * ── SVG Layers ────────────────────────────────────────────────────────
       *
       * All ERASE fills rendered first (clears all original ink before any
       * text beds are drawn), then all TEXT BED fills, then all BORDER strokes.
       * This ordering prevents z-order bleeding between adjacent/overlapping
       * bubbles, and ensures borders are always drawn on top of fills.
       */}
      <Svg width={displayW} height={displayH} style={StyleSheet.absoluteFillObject}>

        {/* ── ERASE ──────────────────────────────────────────────────────────
            Tight OCR polygon fill at full opacity.
            Removes original glyph ink using the bubble's own background colour.
            Deliberately NOT the full bubble — preserves the bubble border and
            any artwork outside the text glyphs. */}
        {items.map((item) => item && (
          <Path
            key={`erase-${item.key}`}
            d={item.erasePath}
            fill={item.bgColor}
            fillOpacity={1}
          />
        ))}

        {/* ── TEXT BED ───────────────────────────────────────────────────────
            Full bubble outline filled with bgColor at 92% opacity.
            Replaces the old 78%-black overlay entirely.
            White speech bubble → white fill → dark text (#1A1A1A) on top.
            Dark panel          → dark fill  → light text (#F8F8F8) on top.
            The result looks like the original bubble with translated text —
            no visible dark rectangle over the artwork.
            Skipped for SFX: sound effects render directly on the artwork. */}
        {items.map((item) => item && !item.isSFX && (
          <Path
            key={`bed-${item.key}`}
            d={item.textBedPath}
            fill={item.bgColor}
            fillOpacity={0.92}
          />
        ))}

        {/* ── BORDER ─────────────────────────────────────────────────────────
            Thin contrast stroke tracing the bubble outline.
            Dark (rgba 20,20,20 @ 40%) for white/light bubbles — restores the
            natural black manga bubble border.
            Light (rgba 220,220,220 @ 45%) for dark panels.
            Dashed (4 3 pattern) for thought bubbles.
            Skipped for SFX. */}
        {items.map((item) => item && !item.isSFX && (
          <Path
            key={`border-${item.key}`}
            d={item.textBedPath}
            fill="none"
            stroke={item.borderStroke}
            strokeWidth={1.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={item.borderDashArray}
          />
        ))}

        {/* ── DEBUG: Bubble polygon outline (red) */}
        {DEBUG_OVERLAY && items.map((item) => item && (
          <Path
            key={`dbg-bubble-${item.key}`}
            d={item.bubblePath}
            fill="none"
            stroke="#FF0000"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {/* ── DEBUG: OCR glyph polygon (blue dashed) */}
        {DEBUG_OVERLAY && items.map((item) => item && (
          <Path
            key={`dbg-ocr-${item.key}`}
            d={item.ocrPath}
            fill="none"
            stroke="#0088FF"
            strokeWidth={1}
            strokeDasharray="4 2"
          />
        ))}

        {/* ── DEBUG: Text container safe zone (green dashed) */}
        {DEBUG_OVERLAY && items.map((item) => item && (
          <Rect
            key={`dbg-container-${item.key}`}
            x={item.containerX}
            y={item.containerY}
            width={item.containerW}
            height={item.containerH}
            fill="none"
            stroke="#00FF88"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        ))}

      </Svg>

      {/*
       * ── Text Layer ────────────────────────────────────────────────────────
       *
       * Text colour is adaptive — no hardcoded white:
       *   Light bubble (#ffffff bgColor) → #1A1A1A dark text + light halo
       *   Dark panel   (#1a1a1a bgColor) → #F8F8F8 light text + dark halo
       *   SFX                            → #FFE566 yellow + heavy shadow
       *
       * Readability without a dark overlay:
       *   White bubble + dark text = ~14:1 contrast ratio (WCAG AAA)
       *   Dark panel  + light text = ~14:1 contrast ratio (WCAG AAA)
       *
       * The text container is positioned at:
       *   X = aabbX + (aabbW - containerW) / 2
       *   Y = aabbY + (aabbH - containerH) / 2
       * so it is always centered in the bubble AABB regardless of rotation.
       */}
      {items.map((item) => {
        if (!item) return null;

        const {
          key, containerX, containerY, containerW, containerH,
          typeset, renderedText, rotDeg, isSFX, isThought,
          textColor, shadowColor, shadowRadius,
        } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                left:      containerX,
                top:       containerY,
                width:     containerW,
                height:    containerH,
                transform: rotDeg !== 0 ? [{ rotate: `${rotDeg}deg` }] : undefined,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  fontSize:   typeset.fontSize,
                  lineHeight: typeset.lineHeight,
                  color:      textColor,
                  fontFamily: ARABIC_FONT_FAMILY,
                  fontWeight: isSFX ? "900" : "700",
                  fontStyle:  isThought ? "italic" : "normal",
                  ...Platform.select({
                    web: {
                      textShadow: isSFX
                        ? `0px 0px 4px ${shadowColor}, 0px 0px 10px rgba(0,0,0,0.8)`
                        : `0px 0px ${shadowRadius}px ${shadowColor}`,
                      WebkitFontSmoothing: "antialiased",
                      textRendering:       "optimizeLegibility",
                    } as object,
                    default: {
                      textShadowColor:  shadowColor,
                      textShadowOffset: { width: 0, height: 0 },
                      textShadowRadius: shadowRadius,
                    },
                  }),
                },
              ]}
            >
              {renderedText}
            </Text>

            {/* DEBUG: font size + container dimensions label */}
            {DEBUG_OVERLAY && (
              <Text style={styles.debugLabel}>
                {typeset.fontSize}px {containerW.toFixed(0)}×{containerH.toFixed(0)}
              </Text>
            )}
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
    overflow:        "hidden",
  },
  label: {
    includeFontPadding:  false,
    textAlignVertical:   "center",
    textAlign:           "center",
    writingDirection:    "rtl",
    letterSpacing:       0,
  },
  debugLabel: {
    position:          "absolute",
    top:               0,
    left:              0,
    fontSize:          8,
    color:             "#00FF00",
    backgroundColor:   "rgba(0,0,0,0.8)",
    paddingHorizontal: 2,
  },
});

export default memo(SkiaOverlayCanvas);
