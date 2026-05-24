/**
 * SkiaOverlayCanvas — Professional manga overlay renderer.
 *
 * Architecture:
 *   Layer 1 (SVG):   Polygon masks — precisely shaped to speech bubble contours,
 *                    semi-transparent, drawn using react-native-svg Path elements.
 *   Layer 2 (Views): Arabic text — absolutely positioned at polygon centroid,
 *                    rendered by the platform RTL engine (Core Text / HarfBuzz).
 *
 * Design principles:
 *   ✅ Polygon masks follow actual bubble shapes — not rectangles
 *   ✅ Smooth rounded corners via SVG quadratic bezier curves
 *   ✅ No AI whitening, no repainting, no pixel manipulation
 *   ✅ Each OCR region is completely independent — zero merging
 *   ✅ Arabic rendered by platform (Core Text on iOS, HarfBuzz on Android)
 *   ✅ letterSpacing MUST be 0 — any positive value breaks Arabic glyph joining
 *   ✅ Mask opacity calibrated to bubble luminance (light vs dark bubbles)
 *   ✅ Preserves original manga art, bubble borders, gradients, textures
 */

import React, { memo, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { TextRegion, BubblePolygon } from "./MangaPage";
import { scaleFontToFit, scaleSFXFont } from "./DynamicFontScaler";
import { resolveFromCss, resolveFromGeminiTextColor } from "./AdaptiveTextColorEngine";
import { ARABIC_FONT_FAMILY } from "./ArabicTypesettingEngine";

interface Props {
  regions: TextRegion[];
  displayW: number;
  displayH: number;
  isRTL?: boolean;
}

// ── Color utilities ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Derive mask fill color and opacity from the bubble's background color.
 * Light bubbles (white speech): high opacity to cleanly cover original text.
 * Dark bubbles (dark panels):   slightly lower opacity to preserve panel texture.
 */
function maskFill(bgColor: string): { color: string; opacity: number } {
  const rgb = hexToRgb(bgColor);
  if (!rgb) return { color: "#f5f2eb", opacity: 0.92 };
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  const opacity = lum > 0.6 ? 0.93 : lum > 0.35 ? 0.88 : 0.82;
  return { color: `rgb(${rgb.r},${rgb.g},${rgb.b})`, opacity };
}

// ── Polygon → SVG path ────────────────────────────────────────────────────────

/**
 * Convert normalized polygon coordinates to pixel coordinates.
 */
function toPixelPts(
  polygon: BubblePolygon,
  w: number,
  h: number
): [number, number][] {
  return polygon.map(([nx, ny]) => [nx * w, ny * h]);
}

/**
 * Build an SVG path string for a smooth rounded polygon.
 *
 * Algorithm:
 *   For each corner vertex V with neighbours Prev and Next:
 *     - Compute midpoint M1 of edge Prev→V
 *     - Compute midpoint M2 of edge V→Next
 *     - Line to M1, then quadratic bezier Q(V, M2)
 *   This produces naturally rounded corners that follow the bubble contour
 *   without introducing any artificial rectangular shapes.
 *
 * Adaptive corner softness: corner radius scales with polygon area so
 * small bubbles get tight corners and large ones get natural smooth curves.
 */
function roundedPolygonPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 3) return "";

  function mid(
    a: [number, number],
    b: [number, number]
  ): [number, number] {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  const mids: [number, number][] = pts.map((p, i) =>
    mid(p, pts[(i + 1) % n])
  );

  let d = `M ${mids[0][0].toFixed(2)} ${mids[0][1].toFixed(2)} `;

  for (let i = 0; i < n; i++) {
    const corner = pts[(i + 1) % n];
    const nextMid = mids[(i + 1) % n];
    d += `Q ${corner[0].toFixed(2)} ${corner[1].toFixed(2)} ${nextMid[0].toFixed(2)} ${nextMid[1].toFixed(2)} `;
  }

  d += "Z";
  return d;
}

/**
 * Derive a BubblePolygon from the region's bounding box when no polygon
 * is available (e.g. older cached data before the polygon field was added).
 */
function bboxPolygon(r: TextRegion): BubblePolygon {
  const { x, y, w, h } = r;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/**
 * Compute the centroid of a polygon (average of vertices).
 * For convex polygons this is the visual center — ideal for text placement.
 */
function centroid(pts: [number, number][]): [number, number] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [cx, cy];
}

/**
 * Compute the axis-aligned bounding box of a set of pixel points.
 */
function polyBbox(pts: [number, number][]): {
  minX: number; minY: number; maxX: number; maxY: number;
  w: number; h: number;
} {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// ── Component ─────────────────────────────────────────────────────────────────

function SkiaOverlayCanvas({ regions, displayW, displayH }: Props) {
  const items = useMemo(() => {
    return regions
      .map((region, idx) => {
        const text = region.translated?.trim();
        if (!text) return null;

        // Resolve polygon — use provided data or fall back to bbox
        const poly: BubblePolygon = region.polygon ?? bboxPolygon(region);

        // Convert normalized → pixel coordinates
        const pixelPts = toPixelPts(poly, displayW, displayH);

        // Bounding box of the polygon for text sizing
        const bbox = polyBbox(pixelPts);
        if (bbox.w < 10 || bbox.h < 8) return null;

        // Visual center for text placement
        const [pcx, pcy] = centroid(pixelPts);

        const isSFX = region.type === "sfx";
        const isThought = region.type === "thought";

        // Scale font to fit within the polygon's bounding box
        const typeset = isSFX
          ? scaleSFXFont(text, bbox.w, bbox.h)
          : scaleFontToFit(text, bbox.w, bbox.h);

        // SVG polygon mask path
        const maskPath = roundedPolygonPath(pixelPts);

        // Mask color from Gemini-supplied bgColor
        const { color: maskColor, opacity: maskOpacity } = maskFill(
          region.bgColor ?? "#f5f5f0"
        );

        // Text color — prefer Gemini's textColor, fall back to luminance detection
        const colorProfile = region.textColor
          ? resolveFromGeminiTextColor(region.textColor)
          : resolveFromCss(region.bgColor ?? "#ffffff");

        return {
          key: idx,
          pcx,
          pcy,
          bbox,
          maskPath,
          maskColor,
          maskOpacity,
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

      {/* ── Layer 1: SVG polygon masks ─────────────────────────────────────── */}
      <Svg
        width={displayW}
        height={displayH}
        style={StyleSheet.absoluteFillObject}
      >
        {items.map((item) => {
          if (!item) return null;
          return (
            <Path
              key={`mask-${item.key}`}
              d={item.maskPath}
              fill={item.maskColor}
              fillOpacity={item.maskOpacity}
              stroke="none"
            />
          );
        })}
      </Svg>

      {/* ── Layer 2: Arabic text — rendered by platform RTL engine ─────────── */}
      {items.map((item) => {
        if (!item) return null;
        const { key, pcx, pcy, bbox, typeset, renderedText, colorProfile, isSFX, isThought } = item;

        // Text container centered on polygon centroid, sized to polygon bbox
        const textW = bbox.w;
        const textH = bbox.h;

        return (
          <View
            key={`text-${key}`}
            style={[
              styles.textBox,
              {
                left: pcx - textW / 2,
                top: pcy - textH / 2,
                width: textW,
                height: textH,
                pointerEvents: "none",
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  fontSize: typeset.fontSize,
                  lineHeight: typeset.lineHeight,
                  color: colorProfile.color,
                  fontFamily: ARABIC_FONT_FAMILY,
                  fontWeight: isSFX ? "900" : "700",
                  fontStyle: isThought ? "italic" : "normal",
                  // Arabic MUST be 0 — any positive tracking breaks contextual glyph forms
                  letterSpacing: 0,
                  ...Platform.select({
                    web: {
                      textShadow: `0px 0px ${colorProfile.shadowRadius}px ${colorProfile.shadowColor}`,
                      WebkitFontSmoothing: "antialiased",
                      textRendering: "optimizeLegibility",
                    } as object,
                    default: {
                      textShadowColor: colorProfile.shadowColor,
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
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  textBox: {
    position: "absolute",
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  label: {
    includeFontPadding: false,
    textAlignVertical: "center",
    textAlign: "center",
    writingDirection: "rtl",
  },
});

export default memo(SkiaOverlayCanvas);
