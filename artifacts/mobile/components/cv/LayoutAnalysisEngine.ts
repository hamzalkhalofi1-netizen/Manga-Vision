/**
 * LayoutAnalysisEngine
 *
 * Analyses the spatial structure of a manga page to produce:
 *   1. Manga reading order (right-to-left, top-to-bottom)
 *   2. Panel cluster groups (spatially proximate region sets)
 *   3. Column assignment (left half vs right half of page)
 *
 * Manga reading conventions:
 *   Japanese manga: right-to-left, double-page spreads read right-to-left.
 *   Korean manhwa: single column, top-to-bottom.
 *   This engine handles both via the `direction` parameter.
 *
 * Algorithm:
 *   1. Compute centroid of each region.
 *   2. Assign to left/right column based on centroid.x relative to page midpoint.
 *   3. Sort: right column first (manga RTL), within each column ascending y.
 *   4. Assign panel groups: regions whose centroids are within PANEL_GAP of each
 *      other (in L∞ norm) belong to the same panel group.
 *   5. Return LayoutAnnotation[] sorted by reading order.
 *
 * Panel group detection uses a greedy connected-components scan rather than
 * DBSCAN to stay dependency-free and remain O(n²) on the small region counts
 * typical of a manga page (usually 2–20 bubbles).
 */

export type ReadingDirection = "rtl" | "ltr" | "ttb";

export interface LayoutRegion {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  centroidX: number;
  centroidY: number;
}

export interface LayoutAnnotation {
  index: number;
  readingOrder: number;
  column: "left" | "right" | "full";
  panelGroup: number;
  centroidX: number;
  centroidY: number;
}

export interface LayoutResult {
  annotations: LayoutAnnotation[];
  panelCount: number;
  columnCount: number;
  readingDirection: ReadingDirection;
}

const PANEL_GAP = 0.28;

function centroid(x: number, y: number, w: number, h: number) {
  return { cx: x + w / 2, cy: y + h / 2 };
}

function column(cx: number, w: number): "left" | "right" | "full" {
  if (w > 0.60) return "full";
  return cx >= 0.50 ? "right" : "left";
}

function chebyshevDist(
  a: { cx: number; cy: number },
  b: { cx: number; cy: number }
): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));
}

function detectDirection(regions: LayoutRegion[]): ReadingDirection {
  if (regions.length === 0) return "rtl";
  const wideRegions = regions.filter((r) => r.w > 0.55);
  if (wideRegions.length > regions.length * 0.6) return "ttb";
  return "rtl";
}

function computePanelGroups(
  layoutRegions: Array<{ index: number; cx: number; cy: number }>
): number[] {
  const groups = new Array<number>(layoutRegions.length).fill(-1);
  let nextGroup = 0;

  for (let i = 0; i < layoutRegions.length; i++) {
    if (groups[i] >= 0) continue;
    groups[i] = nextGroup;
    for (let j = i + 1; j < layoutRegions.length; j++) {
      if (groups[j] >= 0) continue;
      if (chebyshevDist(layoutRegions[i], layoutRegions[j]) <= PANEL_GAP) {
        groups[j] = nextGroup;
      }
    }
    nextGroup++;
  }
  return groups;
}

/**
 * Analyse layout for a set of regions.
 *
 * @param regions    Array of region objects with x/y/w/h (normalized 0–1).
 * @param direction  Override reading direction.  If omitted, auto-detected.
 */
export function analyseLayout(
  regions: Array<{ x: number; y: number; w: number; h: number }>,
  direction?: ReadingDirection
): LayoutResult {
  if (regions.length === 0) {
    return { annotations: [], panelCount: 0, columnCount: 0, readingDirection: "rtl" };
  }

  const layoutRegions: LayoutRegion[] = regions.map((r, i) => {
    const { cx, cy } = centroid(r.x, r.y, r.w, r.h);
    return { index: i, x: r.x, y: r.y, w: r.w, h: r.h, centroidX: cx, centroidY: cy };
  });

  const dir = direction ?? detectDirection(layoutRegions);

  const centroids = layoutRegions.map((r) => ({
    index: r.index,
    cx: r.centroidX,
    cy: r.centroidY,
  }));

  const panelGroupIds = computePanelGroups(centroids);
  const panelCount = new Set(panelGroupIds).size;

  const cols = layoutRegions.map((r) => column(r.centroidX, r.w));
  const columnSet = new Set(cols.filter((c) => c !== "full"));
  const columnCount = columnSet.size;

  const indexedWithMeta = layoutRegions.map((r, i) => ({
    ...r,
    col: cols[i],
    panelGroup: panelGroupIds[i],
  }));

  if (dir === "ttb") {
    indexedWithMeta.sort((a, b) => a.centroidY - b.centroidY || a.centroidX - b.centroidX);
  } else {
    indexedWithMeta.sort((a, b) => {
      const colOrder = { right: 0, full: 1, left: 2 };
      const cA = colOrder[a.col] ?? 1;
      const cB = colOrder[b.col] ?? 1;
      if (cA !== cB) return cA - cB;
      const yDiff = a.centroidY - b.centroidY;
      if (Math.abs(yDiff) > 0.05) return yDiff;
      return b.centroidX - a.centroidX;
    });
  }

  const readingOrderMap = new Map<number, number>();
  indexedWithMeta.forEach((r, order) => {
    readingOrderMap.set(r.index, order);
  });

  const annotations: LayoutAnnotation[] = layoutRegions.map((r) => ({
    index: r.index,
    readingOrder: readingOrderMap.get(r.index) ?? r.index,
    column: cols[layoutRegions.indexOf(r)],
    panelGroup: panelGroupIds[layoutRegions.indexOf(r)],
    centroidX: r.centroidX,
    centroidY: r.centroidY,
  }));

  annotations.sort((a, b) => a.readingOrder - b.readingOrder);

  return { annotations, panelCount, columnCount, readingDirection: dir };
}

/**
 * Sort an array of regions into manga reading order (RTL).
 * Returns a new array; the original is not mutated.
 */
export function sortByReadingOrder<T extends { x: number; y: number; w: number; h: number }>(
  regions: T[],
  direction?: ReadingDirection
): T[] {
  if (regions.length === 0) return [];
  const result = analyseLayout(regions, direction);
  const ordered = new Array<T>(regions.length);
  for (const ann of result.annotations) {
    ordered[ann.readingOrder] = regions[ann.index];
  }
  return ordered.filter(Boolean);
}
