/**
 * SkiaOverlayCanvas — Professional manga scanlation renderer.
 *
 * Core architectural principle (Koharu-inspired):
 *   The OCR polygon is the SINGLE source of truth for ALL geometry decisions.
 *   The TEXT CONTAINER is sized to the POLYGON DIMENSIONS, not the translated
 *   glyph bounds. This is the key difference between "subtitle overlay" and
 *   "professional scanlation" — translated text fills the speech bubble the
 *   same way the original did.
 *
 * Mask system — three-layer soft masking:
 *   Layer 1  Halo  (polygon + ~8px)  : very faint fill + faint stroke   → soft outer glow
 *   Layer 2  Mid   (polygon + ~5px)  : 40% opacity fill + light stroke  → intermediate feather
 *   Layer 3  Core  (polygon + 4px)   : 100% solid fill                  → fully hides original text
 *
 *   The gradient effect from halo→core makes the mask edge nearly invisible,
 *   blending naturally into the bubble background without visible rectangle edges.
 *
 * Text placement:
 *   • Container = ocrW × ocrH   (polygon dimensions, NOT translated glyph bounds)
 *   • Anchor    = true centroid  (Shoelace area-weighted, not bbox center)
 *   • Rotation  = polygon top-edge angle, clamped ±30°
 *   • Font      = largest size from ladder that fits within 91% of polygon dims
 *   • Wrapping  = pre-computed by ArabicTypesettingEngine, centered in container
 *
 * What is NOT changed (per instructions):
 *   translationQueue, inpaintClient, reader UI, source system, API flow.
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Polygon as SvgPolygon } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { measureLine, ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";

interface Props {
  regions:  TextRegion[];
  displayW: number;
  displayH: number;
  isRTL?:   boolean;
}

// ── Polygon geometry ─────────────────────────────────────────────────────────

/**
 * polygonCentroid — area-weighted centroid via Shoelace formula.
 * Falls back to simple vertex average for degenerate polygons.
 * Absolute pixel coordinates expected (not normalized).
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
 * Used to grow the mask polygon for halo and feather rings.
 */
function expandPolygon(
  pts: [number, number][],
  cx: number,
  cy: number,
  px: number,
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
 * polygonRotationDeg — angle of the polygon dominant axis in degrees.
 * Uses the top-edge direction (pts[0]→pts[1], clockwise ordering).
 * Clamped to ±30°; angles < 2° are treated as 0 to skip needless transforms.
 */
function polygonRotationDeg(pts: [number, number][]): number {
  if (pts.length < 2) return 0;
  const dx = pts[1][0] - pts[0][0];
  const dy = pts[1][1] - pts[0][1];
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg > 90)  deg -= 180;
  if (deg < -90) deg += 180;
  deg = Math.max(-30, Math.min(30, deg));
  return Math.abs(deg) < 2 ? 0 : Math.round(deg * 10) / 10;
}

/**
 * polygonDimensions — width and height along the polygon's own axes.
 *
 * Rotates all vertices into the polygon's local coordinate frame so that
 * the measurement captures true text-region size for angled bubbles.
 * An axis-aligned bbox would over-estimate width for rotated text.
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
  const us: number[] = [];
  const vs: number[] = [];
  for (const [x, y] of pts) {
    const rx = x - cx;
    const ry = y - cy;
    us.push(rx * cosA - ry * sinA);
    vs.push(rx * sinA + ry * cosA);
  }
  return {
    w: Math.max(Math.max(...us) - Math.min(...us), 8),
    h: Math.max(Math.max(...vs) - Math.min(...vs), 6),
  };
}

// ── Color helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h    = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * maskFill — exact bubble background color for mask layers.
 *
 * Core fill at 100% opacity guarantees original glyphs are fully hidden.
 * Feather stroke at 30% opacity blends the polygon edge into bubble art.
 */
function maskFill(bgColor: string): { color: string; strokeColor: string } {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return { color: "#f5f2eb", strokeColor: "rgba(245,242,235,0.30)" };
  return {
    color:       `rgb(${rgb.r},${rgb.g},${rgb.b})`,
    strokeColor: `rgba(${rgb.r},${rgb.g},${rgb.b},0.30)`,
  };
}

// ── Placement ────────────────────────────────────────────────────────────────

interface Placement {
  cx: number;
  cy: number;
  /** Polygon extent along its own axes — used for text container sizing */
  ocrW: number;
  ocrH: number;
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
    return { cx, cy, ocrW, ocrH, absolutePts, rotDeg };
  }

  // Fallback: synthetic rectangle from bbox
  const ocrW  = region.w * displayW;
  const ocrH  = region.h * displayH;
  const cx    = (region.centroid?.x ?? region.x + region.w / 2) * displayW;
  const cy    = (region.centroid?.y ?? region.y + region.h / 2) * displayH;
  const rotDeg = region.rotation ?? 0;
  const hw = ocrW / 2, hh = ocrH / 2;
  const absolutePts: [number, number][] = [
    [cx - hw, cy - hh], [cx + hw, cy - hh],
    [cx + hw, cy + hh], [cx - hw, cy + hh],
  ];
  if (ocrW < 8 || ocrH < 6) return null;
  return { cx, cy, ocrW, ocrH, absolutePts, rotDeg };
}

// ── ptsToStr ─────────────────────────────────────────────────────────────────

function ptsToStr(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Core mask expansion — fully covers anti-aliased glyph fringe */
const CORE_EXPAND  = 4;

/** Stroke widths for the feather rings */
const HALO_STROKE_W  = 14;
const MID_STROKE_W   = 6;
const CORE_STROKE_W  = 1.5;

// ── Component ────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        const placement = getPlacement(region, displayW, displayH);
        if (!placement) return null;
        const { cx, cy, ocrW, ocrH, absolutePts, rotDeg } = placement;

        const isSFX     = region.type === "sfx";
        const isThought = region.type === "thought";

        // ── Font scaling ──────────────────────────────────────────────────────
        //
        // scaleFontToFit uses 91% of ocrW × ocrH as the safe zone.
        // The returned fontSize + lines are used for rendering.
        const typeset = isSFX
          ? scaleSFXFont(text, ocrW, ocrH)
          : scaleFontToFit(text, ocrW, ocrH);

        // Skip invisible text
        if (typeset.lines.length === 0) return null;

        // ── Three-layer mask geometry ─────────────────────────────────────────
        //
        // Halo expand: proportional to polygon size, clamped 5–10px.
        // This ensures the feather effect scales reasonably with text regions
        // of different sizes (large SFX vs. small dialogue bubbles).
        const haloExpand = Math.max(5, Math.min(10, ocrW * 0.08));
        const midExpand  = haloExpand * 0.55;

        const haloExpanded = expandPolygon(absolutePts, cx, cy, haloExpand);
        const midExpanded  = expandPolygon(absolutePts, cx, cy, midExpand);
        const coreExpanded = expandPolygon(absolutePts, cx, cy, CORE_EXPAND);

        const haloPoints = ptsToStr(haloExpanded);
        const midPoints  = ptsToStr(midExpanded);
        const corePoints = ptsToStr(coreExpanded);

        // ── Mask colors ───────────────────────────────────────────────────────
        const { color: maskColor, strokeColor } = maskFill(region.bgColor ?? "#f5f2eb");

        // ── Text color ────────────────────────────────────────────────────────
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          cx, cy,
          // Polygon dimensions → text container size.
          // Key invariant: container = polygon bounds, NOT translated glyph bounds.
          ocrW, ocrH,
          // Three-layer mask points
          haloPoints, midPoints, corePoints,
          maskColor, strokeColor,
          // Typography
          typeset,
          renderedText: typeset.lines.join("\n"),
          colorProfile,
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
       * ── Layer 1: Three-layer soft mask system ─────────────────────────────
       *
       * All mask polygons render before text to establish correct z-order.
       * Three separate map passes ensure consistent layering across all
       * regions (halo-of-A never renders above core-of-B).
       *
       * Rendering order (back to front):
       *   1a. All halo rings (widest, most transparent)
       *   1b. All mid rings  (intermediate feather)
       *   1c. All solid cores (100% opacity, primary text cover)
       */}
      <Svg
        width={displayW}
        height={displayH}
        style={StyleSheet.absoluteFillObject}
      >
        {/* 1a: Halo — outer soft glow, very faint */}
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

        {/* 1b: Mid ring — intermediate feather zone */}
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

        {/* 1c: Solid core — fully hides original text */}
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
       * ── Layer 2: Arabic text ──────────────────────────────────────────────
       *
       * KEY CHANGE vs previous implementation:
       *   Container is sized to POLYGON DIMENSIONS (ocrW × ocrH), not to the
       *   translated glyph bounds. This fills the speech bubble the same way
       *   the original text did, eliminating the "subtitle" appearance.
       *
       *   Text is pre-wrapped by ArabicTypesettingEngine to fit within 91%
       *   of ocrW, then centered inside the full ocrW container.
       *   The 9% breathing room creates natural speech-bubble spacing.
       *
       *   The View is rotated around its center, which is the polygon centroid.
       *   React Native rotates around (left + width/2, top + height/2) =
       *   (cx - ocrW/2 + ocrW/2, cy - ocrH/2 + ocrH/2) = (cx, cy). Correct.
       */}
      {items.map((item) => {
        if (!item) return null;
        const {
          key, cx, cy, ocrW, ocrH,
          typeset, renderedText, colorProfile,
          rotDeg, isSFX, isThought,
        } = item;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                left:   cx - ocrW / 2,
                top:    cy - ocrH / 2,
                width:  ocrW,
                height: ocrH,
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
                  // Arabic: letterSpacing MUST be 0.
                  // Any positive value breaks contextual glyph joining
                  // (initial / medial / final / isolated forms).
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
    // overflow: "visible" — allow text to extend slightly past container
    // in edge cases where the font scaler and native measurement diverge.
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
