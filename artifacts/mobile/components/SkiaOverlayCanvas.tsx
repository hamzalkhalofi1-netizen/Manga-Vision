/**
 * SkiaOverlayCanvas — Professional manga scanlation renderer.
 *
 * ── Rendering architecture ───────────────────────────────────────────────────
 *
 * Three SVG layers + one React Native text layer per region:
 *
 *   LAYER 1 — ERASE (SVG):
 *     Solid fill using the bubble's bgColor at full opacity.
 *     Covers the original manga text completely.
 *     Uses bubblePolygon (if provided by Gemini) or OCR polygon expanded 35%.
 *     Smooth bezier path — rounds corners to follow bubble silhouette.
 *
 *   LAYER 2 — DARK BACKGROUND (SVG):
 *     rgba(0,0,0,0.78) fill inside the bubble polygon.
 *     Provides a consistent, readable surface for translated text.
 *     Skipped for SFX regions (sound effects sit on the artwork directly).
 *
 *   LAYER 3 — BORDER (SVG):
 *     Thin white stroke at 18% opacity around the bubble boundary.
 *     Polished edge that separates the overlay from artwork.
 *     Skipped for SFX.
 *
 *   LAYER 4 — TEXT (React Native View + Text):
 *     White text centered in TEXT_SAFE (85%) of the bubble AABB.
 *     overflow: hidden prevents any bleed outside the container.
 *     Font auto-sized from 24 → 8 px until all text fits.
 *     Arabic RTL, balanced line distribution.
 *
 * ── Bubble polygon source (priority order) ──────────────────────────────────
 *
 *   1. region.bubblePolygon — Gemini-provided full bubble outline (best)
 *   2. OCR polygon (region.polygon) expanded by 35% — approximate fallback
 *   3. Bounding-box rectangle expanded by 35% — last resort
 *
 * ── Debug mode ───────────────────────────────────────────────────────────────
 *
 *   Set DEBUG_OVERLAY = true to see:
 *   • Red outline: bubble polygon boundary
 *   • Blue dashed outline: OCR glyph polygon
 *   • Green dashed outline: text container (safe zone)
 *   • Font size + container dimensions label
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { TextRegion } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";

// ── Debug ─────────────────────────────────────────────────────────────────────

/**
 * DEBUG_OVERLAY — set true to draw polygon boundaries, font size labels,
 * and container outlines. NEVER commit with true.
 */
const DEBUG_OVERLAY = false;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fraction of the bubble AABB used for the text container and font fitting. */
const TEXT_SAFE = 0.85;

/**
 * BUBBLE_EXPAND_RATIO — when no bubblePolygon is available, expand the OCR
 * polygon by this fraction of its longest span to approximate the speech bubble.
 * 0.35 → bubble ≈ 1.35× the OCR glyph bounds on each side from centroid.
 */
const BUBBLE_EXPAND_RATIO = 0.35;

/** Minimum expansion in pixels (prevents tiny bubbles from under-expanding). */
const BUBBLE_EXPAND_MIN_PX = 20;

/** Dark background fill opacity (70–85% per spec). */
const BUBBLE_BG_OPACITY = 0.78;

// ── Region filtering ──────────────────────────────────────────────────────────

/**
 * shouldRenderRegion — client-side heuristic filter.
 *
 * Suppresses non-bubble content: UI overlays, subtitle banners, credits,
 * watermarks, tiny decorations, page-edge strips.
 *
 * Conservative — a real bubble will never fail all thresholds simultaneously.
 * When in doubt we render (missing a real bubble is worse than showing noise).
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

  // Minimum area — below this is noise, not a readable bubble
  if (regionW < 20 || regionH < 14)        return false;
  if (regionW * regionH < 500)             return false;

  // Width cap — real speech bubbles do not span more than 70% of the page.
  // Wider regions are UI overlays, chapter banners, or subtitle strips.
  if (regionW > displayW * 0.70)           return false;

  // Subtitle / banner — very wide AND very short.
  const aspectRatio = regionW / Math.max(regionH, 1);
  if (aspectRatio > 5.5 && regionH < 45)  return false;

  // Page-edge strips — chapter/page numbers or credits.
  const isTopStrip    = regionTop < displayH * 0.025 && regionH < displayH * 0.04;
  const isBottomStrip = regionBot > displayH * 0.975 && regionH < displayH * 0.04;
  if (isTopStrip || isBottomStrip)         return false;

  // Sign / title at extreme edges — decorative labels, not translatable dialogue.
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
 * polygonToSmoothPath — midpoint-bezier technique.
 *
 * Rounds every corner of the polygon so the mask silhouette naturally
 * matches manga speech bubble shapes (ovals, rounded rectangles).
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
  /** Centroid of the bubble polygon (display pixels). */
  cx: number; cy: number;
  /** OCR glyph polygon in absolute display pixels. */
  ocrPts: [number, number][];
  /** Bubble polygon in absolute display pixels (for erase + bg layers). */
  bubblePts: [number, number][];
  /** Axis-aligned bounding box of the bubble polygon. */
  aabbX: number; aabbY: number;
  aabbW: number; aabbH: number;
  /** Text container = AABB × TEXT_SAFE, centered within AABB. */
  containerX: number; containerY: number;
  containerW: number; containerH: number;
  /** Rotation derived from OCR polygon dominant axis. */
  rotDeg: number;
}

function getPlacement(
  region: TextRegion,
  displayW: number,
  displayH: number,
): Placement | null {
  // ── OCR polygon ─────────────────────────────────────────────────────────────
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

  // OCR centroid (initial reference)
  const ocrCentroid = region.centroid
    ? { x: region.centroid.x * displayW, y: region.centroid.y * displayH }
    : polygonCentroid(ocrPts);
  let cx = ocrCentroid.x;
  let cy = ocrCentroid.y;

  // ── Bubble polygon ──────────────────────────────────────────────────────────
  let bubblePts: [number, number][];

  if (region.bubblePolygon && region.bubblePolygon.length >= 3) {
    // Use Gemini-provided full bubble outline
    bubblePts = region.bubblePolygon.map(
      ([nx, ny]) => [nx * displayW, ny * displayH] as [number, number],
    );
    // Recompute centroid from bubble polygon for accurate text centering
    const bc = polygonCentroid(bubblePts);
    cx = bc.x; cy = bc.y;
  } else {
    // Fallback: expand OCR polygon to approximate the speech bubble
    const ocrXs  = ocrPts.map((p) => p[0]);
    const ocrYs  = ocrPts.map((p) => p[1]);
    const ocrSpanX = Math.max(...ocrXs) - Math.min(...ocrXs);
    const ocrSpanY = Math.max(...ocrYs) - Math.min(...ocrYs);
    const ocrSpan  = Math.max(ocrSpanX, ocrSpanY);
    const expandPx = Math.max(ocrSpan * BUBBLE_EXPAND_RATIO, BUBBLE_EXPAND_MIN_PX);
    bubblePts = expandPolygon(ocrPts, cx, cy, expandPx);
  }

  // ── Bubble AABB ─────────────────────────────────────────────────────────────
  const bxs  = bubblePts.map((p) => p[0]);
  const bys  = bubblePts.map((p) => p[1]);
  const aabbX = Math.max(0, Math.min(...bxs));
  const aabbY = Math.max(0, Math.min(...bys));
  const aabbW = Math.min(displayW - aabbX, Math.max(...bxs) - Math.min(...bxs));
  const aabbH = Math.min(displayH - aabbY, Math.max(...bys) - Math.min(...bys));

  if (aabbW < 16 || aabbH < 12) return null;

  // ── Text container = AABB × TEXT_SAFE, centered ──────────────────────────────
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

        const isSFX       = region.type === "sfx";
        const isThought   = region.type === "thought";

        // ── Font sizing against actual bubble AABB ─────────────────────────
        const typeset = isSFX
          ? scaleSFXFont(text, aabbW, aabbH)
          : scaleFontToFit(text, aabbW, aabbH);
        if (typeset.lines.length === 0) return null;

        // ── SVG paths ──────────────────────────────────────────────────────
        // Erase path: tiny extra expansion (3px) for clean edge coverage
        const erasePts  = expandPolygon(bubblePts, cx, cy, 3);
        const erasePath = polygonToSmoothPath(erasePts);
        const bgPath    = polygonToSmoothPath(bubblePts);

        // Debug paths
        const ocrPath    = DEBUG_OVERLAY ? polygonToSmoothPath(ocrPts) : "";
        const bubblePath = DEBUG_OVERLAY ? polygonToSmoothPath(bubblePts) : "";

        const bgColor = region.bgColor || "#ffffff";

        return {
          key: idx,
          erasePath, bgPath,
          ocrPath, bubblePath,
          bgColor,
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
       * All erase fills rendered first (removes original text from every
       * bubble before any dark backgrounds are drawn), then all dark
       * backgrounds, then all borders. This prevents any visual z-order
       * artifacts between adjacent or overlapping bubbles.
       */}
      <Svg width={displayW} height={displayH} style={StyleSheet.absoluteFillObject}>

        {/* 1a — Erase: solid fill with bubble background color */}
        {items.map((item) => item && (
          <Path
            key={`erase-${item.key}`}
            d={item.erasePath}
            fill={item.bgColor}
            fillOpacity={1}
          />
        ))}

        {/* 1b — Dark background: semi-transparent black for text readability */}
        {items.map((item) => item && !item.isSFX && (
          <Path
            key={`bg-${item.key}`}
            d={item.bgPath}
            fill="#000000"
            fillOpacity={BUBBLE_BG_OPACITY}
          />
        ))}

        {/* 1c — Polished border: subtle white edge */}
        {items.map((item) => item && !item.isSFX && (
          <Path
            key={`border-${item.key}`}
            d={item.bgPath}
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* DEBUG: Bubble polygon outline (red) */}
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

        {/* DEBUG: OCR polygon outline (blue dashed) */}
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

        {/* DEBUG: Text container outline (green dashed) */}
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
       * Each text container is:
       *   • Positioned at the safe zone (85%) of the bubble AABB
       *   • overflow: hidden — text clips at container boundary (no bleed)
       *   • Always white text on the dark background (reliable contrast)
       *   • Auto font size: 24 → 8 px cascade until text fits
       *   • Arabic RTL, centered, balanced line distribution
       *
       * SFX: bright yellow text, no dark bg, heavy shadow for visibility.
       */}
      {items.map((item) => {
        if (!item) return null;
        const {
          key, containerX, containerY, containerW, containerH,
          typeset, renderedText, rotDeg, isSFX, isThought,
        } = item;

        const textColor  = isSFX ? "#FFE566" : "#FFFFFF";
        const fontWeight = isSFX ? "900" : "700";

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
                  fontWeight,
                  fontStyle:  isThought ? "italic" : "normal",
                  ...Platform.select({
                    web: {
                      textShadow: isSFX
                        ? "0px 0px 4px rgba(0,0,0,0.95), 0px 0px 10px rgba(0,0,0,0.8)"
                        : "0px 0px 3px rgba(0,0,0,0.6)",
                      WebkitFontSmoothing: "antialiased",
                      textRendering:       "optimizeLegibility",
                    } as object,
                    default: {
                      textShadowColor:  "rgba(0,0,0,0.75)",
                      textShadowOffset: { width: 0, height: 0 },
                      textShadowRadius: isSFX ? 8 : 3,
                    },
                  }),
                },
              ]}
            >
              {renderedText}
            </Text>

            {/* DEBUG: Font size + container dimensions */}
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
    position:        "absolute",
    top:             0,
    left:            0,
    fontSize:        8,
    color:           "#00FF00",
    backgroundColor: "rgba(0,0,0,0.8)",
    paddingHorizontal: 2,
  },
});

export default memo(SkiaOverlayCanvas);
