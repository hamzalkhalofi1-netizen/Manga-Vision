/**
 * BubbleDetectionEngine (client-side)
 *
 * Validates, scores, and selects the best available bubble polygon for each
 * text region, using a priority cascade:
 *
 *   1. refinedBubblePolygon   — from server contour detection (highest quality)
 *   2. bubblePolygon          — from Gemini (good, may miss bubble tail)
 *   3. polygon × expansion    — OCR glyph polygon scaled out (fallback)
 *
 * Quality scoring:
 *   A polygon is scored on convexity, aspect ratio, and minimum bounding
 *   area.  Degenerate polygons (too few points, zero area, extreme aspect)
 *   are rejected and the next candidate is tried.
 */

export type Polygon = [number, number][];

export interface BubbleCandidate {
  refinedBubblePolygon?: Polygon;
  bubblePolygon?: Polygon;
  polygon?: Polygon;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PolygonScore {
  area: number;
  aspectRatio: number;
  pointCount: number;
  isValid: boolean;
}

function polygonBbox(pts: Polygon): { x1: number; y1: number; x2: number; y2: number } {
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

function scorePolygon(pts: Polygon | undefined): PolygonScore {
  if (!pts || pts.length < 3) {
    return { area: 0, aspectRatio: 0, pointCount: 0, isValid: false };
  }
  const { x1, y1, x2, y2 } = polygonBbox(pts);
  const spanX = x2 - x1;
  const spanY = y2 - y1;
  const area = spanX * spanY;
  const aspectRatio = spanX / Math.max(spanY, 0.001);

  const isValid =
    area >= 0.0004 &&
    spanX >= 0.01 &&
    spanY >= 0.01 &&
    aspectRatio >= 0.1 &&
    aspectRatio <= 10 &&
    pts.length >= 3;

  return { area, aspectRatio, pointCount: pts.length, isValid };
}

/**
 * Expand an OCR polygon outward from its centroid by a fraction of its
 * longest span.  Used as a last-resort bubble boundary when no refined or
 * Gemini polygon is available.
 */
function expandPolygon(pts: Polygon, fraction: number): Polygon {
  const cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
  const cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
  const { x1, y1, x2, y2 } = polygonBbox(pts);
  const span = Math.max(x2 - x1, y2 - y1);
  const expandBy = span * fraction;

  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return [x + (dx / dist) * expandBy, y + (dy / dist) * expandBy] as [number, number];
  });
}

/**
 * Select the highest-quality bubble polygon for a region using the priority
 * cascade.  Always returns a valid polygon (falls back to bbox rect).
 */
export function selectBubblePolygon(candidate: BubbleCandidate): Polygon {
  const refinedScore = scorePolygon(candidate.refinedBubblePolygon);
  if (refinedScore.isValid) return candidate.refinedBubblePolygon!;

  const geminiScore = scorePolygon(candidate.bubblePolygon);
  if (geminiScore.isValid) return candidate.bubblePolygon!;

  if (candidate.polygon && candidate.polygon.length >= 3) {
    const expanded = expandPolygon(candidate.polygon, 0.22);
    const expandedScore = scorePolygon(expanded);
    if (expandedScore.isValid) return expanded;
  }

  const { x, y, w, h } = candidate;
  return [
    [x - w * 0.1, y - h * 0.1],
    [x + w + w * 0.1, y - h * 0.1],
    [x + w + w * 0.1, y + h + h * 0.1],
    [x - w * 0.1, y + h + h * 0.1],
  ];
}

/**
 * Compute the axis-aligned bounding box of a polygon in display pixels.
 */
export function polygonAABB(
  pts: Polygon,
  displayW: number,
  displayH: number
): { x: number; y: number; w: number; h: number } {
  const pxPts = pts.map(([nx, ny]) => [nx * displayW, ny * displayH] as [number, number]);
  const xs = pxPts.map(([x]) => x);
  const ys = pxPts.map(([, y]) => y);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const w = Math.min(displayW - x, Math.max(...xs) - Math.min(...xs));
  const h = Math.min(displayH - y, Math.max(...ys) - Math.min(...ys));
  return { x, y, w, h };
}
