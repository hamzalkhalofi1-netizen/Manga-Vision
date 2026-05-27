/**
 * SkiaOverlayCanvas — Professional manga scanlation renderer.
 *
 * ── Architecture (Koharu-inspired) ──────────────────────────────────────────
 *
 * The Gemini OCR polygon is glyph-tight — it wraps the ORIGINAL TEXT GLYPHS,
 * not the full speech bubble.  Professional scanlation requires two distinct
 * geometry layers:
 *
 *   MASK layer   → original glyph polygon (tight, covers exactly the ink)
 *   LAYOUT layer → estimated bubble area  (≈1.35× the glyph polygon)
 *
 * The LAYOUT layer is the text container.  Expanding beyond the glyph bounds
 * to approximate the speech bubble is the single most impactful change from
 * the previous "subtitle overlay" approach — translated text now fills the
 * bubble the same way the original did.
 *
 * ── Mask system (three-layer soft feathering) ────────────────────────────────
 *
 *   Halo  polygon + haloExpand px  :  10% fill opacity + very faint stroke
 *   Mid   polygon + midExpand px   :  42% fill opacity + light stroke
 *   Core  polygon + CORE_EXPAND px :  100% fill, full cover of original glyphs
 *
 *   Approaching the edge from outside: bubble art → faint halo → mid feather →
 *   solid core.  The gradient is nearly invisible against the bubble background
 *   because all layers use the exact bgColor sampled by Gemini.
 *
 * ── Text placement ────────────────────────────────────────────────────────────
 *
 *   Container  = layoutW × layoutH  (BUBBLE_LAYOUT_SCALE × polygon dims)
 *   Anchor     = true Shoelace centroid of the OCR polygon
 *   Rotation   = polygon top-edge angle, clamped ±30°
 *   Font size  = largest ladder step that fits 91% of layoutW × layoutH
 *   Wrapping   = ArabicTypesettingEngine pre-wraps to 91% of layoutW,
 *                centered inside the full layoutW container (9% breathing room)
 *
 * ── What is NOT changed ───────────────────────────────────────────────────────
 *   translationQueue, inpaintClient, reader UI, source system, API flow.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon as SvgPolygon } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";

interface Props {
  regions:  TextRegion[];
  displayW: number;
  displayH: number;
  isRTL?:   boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * BUBBLE_LAYOUT_SCALE — how much larger the text container is vs. the OCR polygon.
 *
 * The Gemini OCR polygon is glyph-tight (wraps original text characters only).
 * In professional manga, translated text fills the speech bubble — which is
 * roughly 1.3–1.5× the text column area.  1.35 is the midpoint, producing
 * natural bubble-filling without risking overflow into adjacent art.
 *
 * This scale applies to the TEXT CONTAINER and font sizing only.
 * The SVG mask always uses the ORIGINAL glyph-tight polygon.
 */
const BUBBLE_LAYOUT_SCALE = 1.35;

/** Core mask expansion — pushes polygon vertices outward from centroid.
 *  Covers the 2–4 px anti-aliased fringe at glyph edges. */
const CORE_EXPAND = 4;

/** Feather ring stroke widths */
const HALO_STROKE_W = 14;
const MID_STROKE_W  = 6;
const CORE_STROKE_W = 1.5;

// ── Polygon geometry ──────────────────────────────────────────────────────────

/**
 * polygonCentroid — area-weighted centroid via the Shoelace formula.
 * Falls back to a simple vertex average for degenerate (collinear) polygons.
 * Expects absolute pixel coordinates.
 */
function polygonCentroid(pts: [number, number][]): { x: number; y: number } {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n < 3)   return { x: (pts[0][0] + pts[n - 1][0]) / 2, y: (pts[0][1] + pts[n - 1][1]) / 2 };

  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx   += (x0 + x1) * cross;
    cy   += (y0 + y1) * cross;
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

/**
 * expandPolygon — push each vertex outward from the centroid by `px` pixels.
 * Used to generate the halo, mid, and core mask rings.
 */
function expandPolygon(
  pts: [number, number][],
  cx: number,
  cy: number,
  px: number,
): [number, number][] {
  return pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) return [x, y] as [number, number];
    return [x + (dx / dist) * px, y + (dy / dist) * px] as [number, number];
  });
}

/**
 * polygonRotationDeg — angle of the dominant axis in degrees.
 * Derived from the top edge direction (pts[0]→pts[1], clockwise winding).
 * Clamped to ±30°; angles < 2° are treated as 0 to skip redundant transforms.
 */
function polygonRotationDeg(pts: [number, number][]): number {
  if (pts.length < 2) return 0;
  const dx = pts[1][0] - pts[0][0];
  const dy = pts[1][1] - pts[0][1];
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg >  90) deg -= 180;
  if (deg < -90) deg += 180;
  deg = Math.max(-30, Math.min(30, deg));
  return Math.abs(deg) < 2 ? 0 : Math.round(deg * 10) / 10;
}

/**
 * polygonDimensions — width and height along the polygon's own axes.
 *
 * Rotates vertices into the polygon's local frame so that angled text
 * regions are measured along their true dominant axis, not the screen axes.
 * An axis-aligned bbox would over-estimate one dimension for rotated text.
 */
function polygonDimensions(
  pts: [number, number][],
  cx: number,
  cy: number,
  rotDeg: number,
): { w: number; h: number } {
  const angle = rotDeg * (Math.PI / 180);
  const cosA  = Math.cos(-angle);
  const sinA  = Math.sin(-angle);
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h    = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * maskFill — bubble background color for the three mask layers.
 *
 * All three rings (halo, mid, core) share the same hue so the gradient
 * blends naturally — it only changes in opacity, not in color.
 * Full 100% opacity on the core ensures zero bleed-through of original glyphs.
 */
function maskFill(bgColor: string): { color: string; strokeColor: string } {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return { color: "#f5f2eb", strokeColor: "rgba(245,242,235,0.28)" };
  return {
    color:       `rgb(${rgb.r},${rgb.g},${rgb.b})`,
    strokeColor: `rgba(${rgb.r},${rgb.g},${rgb.b},0.28)`,
  };
}

// ── Placement ─────────────────────────────────────────────────────────────────

interface Placement {
  cx: number;
  cy: number;
  /** Glyph-tight polygon dimensions (for mask sizing) */
  ocrW: number;
  ocrH: number;
  /** Estimated bubble dimensions for text layout (BUBBLE_LAYOUT_SCALE × ocr) */
  layoutW: number;
  layoutH: number;
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

    // Scale up to estimated bubble area (see BUBBLE_LAYOUT_SCALE comment)
    const layoutW = ocrW * BUBBLE_LAYOUT_SCALE;
    const layoutH = ocrH * BUBBLE_LAYOUT_SCALE;

    return { cx, cy, ocrW, ocrH, layoutW, layoutH, absolutePts, rotDeg };
  }

  // Fallback: synthetic rectangle from bbox
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

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;

        const { cx, cy, ocrW, ocrH, layoutW, layoutH, absolutePts, rotDeg } = placement;
        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";
        const isNarration = region.type === "narration" || region.type === "sign";

        // ── Font scaling against estimated bubble area ─────────────────────────
        //
        // scaleFontToFit targets layoutW × layoutH (the estimated bubble),
        // NOT the glyph-tight ocrW × ocrH.  This is the primary font-size
        // improvement: larger bubbles → larger, more readable manga fonts.
        //
        // SFX uses a separate ladder starting at 30 px for punchy rendering.
        const typeset = isSFX
          ? scaleSFXFont(text, layoutW, layoutH)
          : scaleFontToFit(text, layoutW, layoutH);

        if (typeset.lines.length === 0) return null;

        // ── Three-layer mask geometry (glyph-tight polygon) ────────────────────
        //
        // Mask geometry is computed from the ORIGINAL glyph polygon (absolutePts),
        // not the expanded layout area.  The mask only needs to cover the original
        // ink — it should not bleed into surrounding bubble art.
        //
        // haloExpand scales proportionally with the polygon size so large SFX
        // regions get a wider feather halo than small dialogue bubbles.
        const haloExpand = Math.max(5, Math.min(11, ocrW * 0.08));
        const midExpand  = haloExpand * 0.55;

        const haloExpanded = expandPolygon(absolutePts, cx, cy, haloExpand);
        const midExpanded  = expandPolygon(absolutePts, cx, cy, midExpand);
        const coreExpanded = expandPolygon(absolutePts, cx, cy, CORE_EXPAND);

        const haloPoints = ptsToStr(haloExpanded);
        const midPoints  = ptsToStr(midExpanded);
        const corePoints = ptsToStr(coreExpanded);

        const { color: maskColor, strokeColor } = maskFill(region.bgColor ?? "#f5f2eb");

        // ── Text color from Gemini-detected or bg-derived profile ──────────────
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        // Narration boxes: slight increase in shadow radius for crisp text
        // on textured rectangular backgrounds (screen tone, color panels).
        const shadowRadius = isNarration
          ? Math.max(colorProfile.shadowRadius, 2.0)
          : colorProfile.shadowRadius;

        return {
          key: idx,
          cx, cy,
          // Text container uses LAYOUT dimensions (estimated bubble area).
          // Mask polygons use OCR glyph-tight dimensions.
          layoutW, layoutH,
          haloPoints, midPoints, corePoints,
          maskColor, strokeColor,
          typeset,
          renderedText: typeset.lines.join("\n"),
          colorProfile: { ...colorProfile, shadowRadius },
          rotDeg,
          isSFX, isThought,
        };
      })
      .filter(Boolean);
  }, [regions, displayW, displayH]);

  if (!items.length) return null;

  return (
    <View style={[styles.root, { pointerEvents: "none" }]}>

      {/*
       * ── Layer 1: Three-layer mask system ────────────────────────────────────
       *
       * Separate map() passes ensure all halo rings render behind all mid rings,
       * which render behind all solid cores — regardless of region z-order.
       * This prevents a halo from one region overlapping the core of another.
       *
       * All layers use the GLYPH-TIGHT polygon (not layoutW/layoutH).
       * The mask covers original ink only — not the full bubble.
       */}
      <Svg
        width={displayW}
        height={displayH}
        style={StyleSheet.absoluteFillObject}
      >
        {/* 1a — Halo: widest ring, most transparent (outer soft glow) */}
        {items.map((item) => item && (
          <SvgPolygon
            key={`halo-${item.key}`}
            points={item.haloPoints}
            fill={item.maskColor}
            fillOpacity={0.10}
            stroke={item.maskColor}
            strokeWidth={HALO_STROKE_W}
            strokeLinejoin="round"
            strokeOpacity={0.06}
          />
        ))}

        {/* 1b — Mid: intermediate feather zone */}
        {items.map((item) => item && (
          <SvgPolygon
            key={`mid-${item.key}`}
            points={item.midPoints}
            fill={item.maskColor}
            fillOpacity={0.42}
            stroke={item.maskColor}
            strokeWidth={MID_STROKE_W}
            strokeLinejoin="round"
            strokeOpacity={0.18}
          />
        ))}

        {/* 1c — Core: solid fill, completely hides original text glyphs */}
        {items.map((item) => item && (
          <SvgPolygon
            key={`core-${item.key}`}
            points={item.corePoints}
            fill={item.maskColor}
            fillOpacity={1}
            stroke={item.strokeColor}
            strokeWidth={CORE_STROKE_W}
            strokeLinejoin="round"
          />
        ))}
      </Svg>

      {/*
       * ── Layer 2: Arabic text ─────────────────────────────────────────────────
       *
       * KEY INVARIANTS:
       *
       *  1. Container is layoutW × layoutH (estimated bubble, not glyph bounds).
       *     This fills the speech bubble naturally, eliminating subtitle appearance.
       *
       *  2. Text is pre-wrapped by ArabicTypesettingEngine to fit 91% of layoutW.
       *     The remaining 9% becomes breathing room on each side — exactly how
       *     professional scanlation teams set text inside speech bubbles.
       *
       *  3. justifyContent: "center" + alignItems: "center" centers the text
       *     block vertically and horizontally within the bubble container.
       *
       *  4. The View is positioned so its center (left + layoutW/2, top + layoutH/2)
       *     lands exactly on the polygon centroid (cx, cy).  React Native rotates
       *     around the view center by default, so the rotate transform is correct.
       */}
      {items.map((item) => {
        if (!item) return null;
        const {
          key, cx, cy, layoutW, layoutH,
          typeset, renderedText, colorProfile,
          rotDeg, isSFX, isThought,
        } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                // Center the container on the polygon centroid
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
                  fontSize:   typeset.fontSize,
                  lineHeight: typeset.lineHeight,
                  color:      colorProfile.color,
                  fontFamily: ARABIC_FONT_FAMILY,
                  fontWeight: isSFX     ? "900" : "700",
                  fontStyle:  isThought ? "italic" : "normal",
                  // CRITICAL: letterSpacing MUST be 0 for Arabic.
                  // Any positive value breaks contextual glyph joining
                  // (initial / medial / final / isolated forms disconnect).
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
    // overflow: "visible" — text is pre-sized to fit layoutW; overflow is a
    // rare edge case where the heuristic measurement diverges from native.
    // Visible overflow is always preferable to clipping translated text.
    overflow: "visible",
  },
  label: {
    includeFontPadding: false,
    textAlignVertical:  "center",
    textAlign:          "center",
    writingDirection:   "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
