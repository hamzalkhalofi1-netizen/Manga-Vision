/**
 * SkiaOverlayCanvas — Polygon-anchored professional manga text overlay.
 *
 * Architecture: every geometric decision flows from the ORIGINAL OCR polygon.
 * The polygon is the single source of truth for:
 *   • mask shape  (SVG Polygon covering original text area)
 *   • text anchor (true area-weighted polygon centroid, not bbox center)
 *   • font sizing  (dimensions along the polygon's dominant axis)
 *   • text tilt    (polygon rotation angle applied to the text view)
 *
 * Pipeline per region:
 *   1. Convert normalized polygon → absolute pixel coordinates
 *   2. Compute true centroid via Shoelace formula
 *   3. Detect rotation angle from the polygon's top edge direction
 *   4. Measure polygon extents along its own axes (handles rotated text)
 *   5. Scale Arabic font to fit those rotated dimensions
 *   6. Expand polygon vertices outward from centroid by MASK_EXPAND px
 *   7. Draw SVG Polygon mask (bubble-matched color at 100% opacity)
 *   8. Render Arabic text centered on centroid, rotated to match polygon
 *
 * Key invariants:
 *   • Mask shape follows the original OCR polygon — not a rectangle
 *   • Mask covers original text area (not translated text area)
 *   • Text anchor is the true centroid — not (minX+maxX)/2 bbox center
 *   • Rotation is applied so text aligns with tilted bubbles
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon as SvgPolygon } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import type { ScaledTypeset } from "./DynamicFontScaler";
import { measureLine, estimateTextHeight } from "./ArabicTypesettingEngine";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";
import { ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";

interface Props {
  regions:  TextRegion[];
  displayW: number;
  displayH: number;
  isRTL?:   boolean;
}

// ── Polygon geometry ───────────────────────────────────────────────────────────

/**
 * polygonCentroid — area-weighted centroid of a simple polygon.
 *
 * Uses the standard Shoelace formula centroid:
 *   Cx = (1/6A) Σ (xi + xi+1)(xi·yi+1 − xi+1·yi)
 *   Cy = (1/6A) Σ (yi + yi+1)(xi·yi+1 − xi+1·yi)
 *
 * Falls back to a simple vertex average for degenerate (nearly collinear)
 * polygons where the signed area approaches zero.
 *
 * Absolute pixel coordinates expected (not normalized).
 */
function polygonCentroid(pts: [number, number][]): { x: number; y: number } {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: pts[0][0], y: pts[0][1] };
  if (n === 2) return { x: (pts[0][0] + pts[1][0]) / 2, y: (pts[0][1] + pts[1][1]) / 2 };

  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area  += cross;
    cx    += (x0 + x1) * cross;
    cy    += (y0 + y1) * cross;
  }
  area /= 2;

  if (Math.abs(area) < 0.5) {
    // Degenerate polygon — use simple average
    return {
      x: pts.reduce((s, [x]) => s + x, 0) / n,
      y: pts.reduce((s, [, y]) => s + y, 0) / n,
    };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/**
 * expandPolygon — push each vertex outward from the polygon centroid by px pixels.
 *
 * This expands the polygon uniformly in all directions, ensuring the mask
 * covers the 2–3px anti-aliased fringe at the edge of original text glyphs.
 */
function expandPolygon(
  pts: [number, number][],
  cx: number,
  cy: number,
  px: number
): [number, number][] {
  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) return [x, y] as [number, number];
    return [x + (dx / dist) * px, y + (dy / dist) * px] as [number, number];
  });
}

/**
 * polygonRotationDeg — angle of the polygon's dominant axis in degrees.
 *
 * Uses the top edge direction (pts[0] → pts[1] for clockwise ordering).
 * Clamped to ±30° — beyond that usually indicates wrong vertex ordering
 * or a near-vertical bubble (which we treat as 0° to avoid upside-down text).
 *
 * Small angles < 2° are normalized to 0 to avoid unnecessary transform cost.
 */
function polygonRotationDeg(pts: [number, number][]): number {
  if (pts.length < 2) return 0;
  const dx = pts[1][0] - pts[0][0];
  const dy = pts[1][1] - pts[0][1];
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  // Wrap to (−90, 90] so horizontal text stays near 0
  if (deg > 90)  deg -= 180;
  if (deg < -90) deg += 180;
  // Clamp to ±30° — extreme angles usually indicate a wrong top edge
  deg = Math.max(-30, Math.min(30, deg));
  // Skip tiny rotations — not worth the rendering overhead
  return Math.abs(deg) < 2 ? 0 : Math.round(deg * 10) / 10;
}

/**
 * polygonDimensions — width and height along the polygon's own axes.
 *
 * Rotates all vertices into the polygon's local coordinate system (defined
 * by the rotation angle), then measures the bounding box in that frame.
 * This correctly captures the text region size for angled bubbles where
 * the axis-aligned bbox would over-estimate one dimension.
 */
function polygonDimensions(
  pts: [number, number][],
  cx: number,
  cy: number,
  rotDeg: number
): { w: number; h: number } {
  const angle  = rotDeg * (Math.PI / 180);
  const cosA   = Math.cos(-angle);
  const sinA   = Math.sin(-angle);

  const us: number[] = [];
  const vs: number[] = [];

  for (const [x, y] of pts) {
    const rx = x - cx;
    const ry = y - cy;
    us.push(rx * cosA - ry * sinA);
    vs.push(rx * sinA + ry * cosA);
  }

  const w = Math.max(...us) - Math.min(...us);
  const h = Math.max(...vs) - Math.min(...vs);
  return { w: Math.max(w, 8), h: Math.max(h, 6) };
}

// ── Color ──────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * maskFill — exact bubble background color at 100% opacity + feathering stroke.
 *
 * Full opacity = zero bleed-through of original glyphs (professional scanlation
 * technique: paint over text with exact bubble fill color).
 *
 * Stroke: same hue at 30% opacity — creates a soft blend into the bubble art
 * at the polygon edge without requiring SVG filter effects.
 */
function maskFill(bgColor: string): { color: string; strokeColor: string } {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return { color: "#f5f2eb", strokeColor: "rgba(245,242,235,0.30)" };
  return {
    color:       `rgb(${rgb.r},${rgb.g},${rgb.b})`,
    strokeColor: `rgba(${rgb.r},${rgb.g},${rgb.b},0.30)`,
  };
}

// ── Placement ─────────────────────────────────────────────────────────────────

interface Placement {
  /** True polygon centroid in absolute pixels */
  cx: number;
  cy: number;
  /** Polygon extent along its own axes (for font sizing) */
  ocrW: number;
  ocrH: number;
  /** Absolute pixel coordinates of all polygon vertices */
  absolutePts: [number, number][];
  /** Text tilt angle in degrees */
  rotDeg: number;
}

/**
 * getPlacement — extract the polygon-anchored geometry for one OCR region.
 *
 * When a polygon is available:
 *   • centroid: server-supplied true centroid, or computed via Shoelace
 *   • rotation: server-supplied angle, or derived from top edge direction
 *   • dimensions: measured along the polygon's own axes (not axis-aligned bbox)
 *
 * When only bbox is available (no polygon):
 *   • synthetic 4-point rectangle polygon is constructed
 *   • center-of-bbox used as centroid fallback
 */
function getPlacement(
  region: TextRegion,
  displayW: number,
  displayH: number
): Placement | null {
  if (region.polygon && region.polygon.length >= 3) {
    const absolutePts = region.polygon.map(
      ([nx, ny]) => [nx * displayW, ny * displayH] as [number, number]
    );

    // True centroid: prefer server-computed (already normalized), else Shoelace
    const centroid = region.centroid
      ? { x: region.centroid.x * displayW, y: region.centroid.y * displayH }
      : polygonCentroid(absolutePts);

    const { x: cx, y: cy } = centroid;

    // Rotation: prefer server-computed, else derive from polygon top edge
    const rotDeg = region.rotation ?? polygonRotationDeg(absolutePts);

    // Font-sizing dimensions along the polygon's own axes
    const { w: ocrW, h: ocrH } = polygonDimensions(absolutePts, cx, cy, rotDeg);

    if (ocrW < 8 || ocrH < 6) return null;
    return { cx, cy, ocrW, ocrH, absolutePts, rotDeg };
  }

  // Fallback: construct synthetic polygon from bbox
  const ocrW = region.w * displayW;
  const ocrH = region.h * displayH;
  const cx   = (region.centroid?.x ?? (region.centerX ?? region.x + region.w / 2)) * displayW;
  const cy   = (region.centroid?.y ?? (region.centerY ?? region.y + region.h / 2)) * displayH;
  const rotDeg = region.rotation ?? 0;

  const hw = ocrW / 2;
  const hh = ocrH / 2;
  const absolutePts: [number, number][] = [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ];

  if (ocrW < 8 || ocrH < 6) return null;
  return { cx, cy, ocrW, ocrH, absolutePts, rotDeg };
}

// ── Glyph measurement ──────────────────────────────────────────────────────────

function glyphBounds(typeset: ScaledTypeset): { w: number; h: number } {
  const { lines, fontSize, lineHeight } = typeset;
  const lhr = fontSize > 0 ? lineHeight / fontSize : 1.3;
  const w = lines.length === 0 ? 0 : Math.max(...lines.map((l) => measureLine(l, fontSize)));
  const h = estimateTextHeight(lines.length, fontSize, lhr);
  return { w, h };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Pixels to expand each polygon vertex outward from the centroid.
 * Covers anti-aliased glyph fringe + 1px sub-pixel rounding margin.
 */
const MASK_EXPAND = 3;

/** Feathering stroke width around the polygon mask. */
const STROKE_W = 2;

// ── Component ─────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        // ── Step 1–4: polygon-anchored geometry ───────────────────────────────
        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;
        const { cx, cy, ocrW, ocrH, absolutePts, rotDeg } = placement;

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // ── Step 5: scale Arabic font to fit polygon's own dimensions ─────────
        const typeset = isSFX
          ? scaleSFXFont(text, ocrW, ocrH)
          : scaleFontToFit(text, ocrW, ocrH);

        const glyph = glyphBounds(typeset);
        if (glyph.w < 4 || glyph.h < 4) return null;

        // ── Step 6: expand polygon vertices outward from centroid ─────────────
        //
        // maskPoints covers the ORIGINAL text area (not translated glyph area).
        // This guarantees no original text bleeds around the mask edge.
        //
        const expanded = expandPolygon(absolutePts, cx, cy, MASK_EXPAND);
        // SVG Polygon points: "x1,y1 x2,y2 ..."
        const maskPoints = expanded.map(([x, y]) => `${x},${y}`).join(" ");

        // ── Step 7: bubble-matched mask fill ──────────────────────────────────
        const { color: maskColor, strokeColor } = maskFill(region.bgColor ?? "#f5f5f0");

        // ── Text color ────────────────────────────────────────────────────────
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          // Polygon centroid — master anchor for text and mask
          cx, cy,
          // Glyph-tight text box (independent from mask size)
          glyphW: glyph.w,
          glyphH: glyph.h,
          // SVG polygon mask
          maskPoints,
          maskColor,
          strokeColor,
          // Text
          typeset,
          renderedText: typeset.lines.join("\n"),
          colorProfile,
          rotDeg,
          isSFX,
          isThought,
        };
      })
      .filter(Boolean);
  }, [regions, displayW, displayH]);

  if (!items.length) return null;

  return (
    <View style={[styles.root, { pointerEvents: "none" }]}>

      {/* ── Layer 1: Polygon-shaped masks (original text area, 100% opacity) ── */}
      <Svg
        width={displayW}
        height={displayH}
        style={StyleSheet.absoluteFillObject}
      >
        {items.map((item) => {
          if (!item) return null;
          return (
            <SvgPolygon
              key={`mask-${item.key}`}
              points={item.maskPoints}
              fill={item.maskColor}
              fillOpacity={1}
              stroke={item.strokeColor}
              strokeWidth={STROKE_W}
              strokeLinejoin="round"
            />
          );
        })}
      </Svg>

      {/* ── Layer 2: Arabic text — centered on polygon centroid + rotated ───── */}
      {items.map((item) => {
        if (!item) return null;
        const {
          key, cx, cy, glyphW, glyphH,
          typeset, renderedText, colorProfile,
          rotDeg, isSFX, isThought,
        } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                left:   cx - glyphW / 2,
                top:    cy - glyphH / 2,
                width:  glyphW,
                height: glyphH,
                // Rotate text to match polygon orientation.
                // Since the view is positioned with its center on the centroid,
                // React Native rotates around the view center — which is exactly
                // the centroid. No additional translate is needed.
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
                  fontWeight:    isSFX     ? "900" : "700",
                  fontStyle:     isThought ? "italic" : "normal",
                  // Arabic: letterSpacing MUST be 0 — any positive value
                  // breaks contextual glyph joining (initial/medial/final forms)
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
