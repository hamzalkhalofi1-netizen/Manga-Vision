/**
 * BubbleDetectionEngine
 *
 * Refines Gemini-provided bubble polygon hints using Canny edge detection
 * and contour analysis on the actual image pixels.
 *
 * Pipeline:
 *   1. RGBA → grayscale.
 *   2. GaussianBlur (5×5, σ=0) to suppress JPEG compression artefacts
 *      and halftone dot patterns common in scanned manga.
 *   3. Canny edge detection (low=40, high=120, apertureSize=3).
 *      These thresholds are tuned for manga which has strong black borders
 *      on white/light backgrounds — low enough to catch thin bubble lines,
 *      high enough to reject halftone noise.
 *   4. findContours (RETR_LIST, CHAIN_APPROX_SIMPLE).
 *   5. For each region's hint polygon:
 *        a. Compute the hint bounding box and centroid.
 *        b. Filter candidate contours:
 *             - Contour must not already be assigned to another region
 *               (uniqueness constraint prevents shared-contour bugs).
 *             - Hint centroid must lie inside the contour bounding rect
 *               (spatial containment check — rejects distant contours).
 *             - IOU between contour bbox and hint bbox must be ≥ 0.30
 *               (raised from 0.20 to reduce false assignments).
 *        c. Best-matching contour (highest IOU) is selected.
 *        d. approxPolyDP at 2.5% perimeter → simplified polygon.
 *        e. Accept if 4–12 vertices, normalize to [0,1].
 *        f. Mark the contour as used; fall back to Gemini bubblePolygon
 *           or polygon if no valid match found.
 *
 * Why uniqueness matters:
 *   Without it, two adjacent regions can both match the same large panel-
 *   border contour (highest IOU for both).  The first region gets the
 *   correct polygon; the second gets a duplicate of the first region's
 *   contour, placing Arabic text in the wrong bubble.
 *
 * CRITICAL — memory safety:
 *   See SegmentationEngine.ts — same Buffer.from(mat.data) copy rule applies.
 */

import sharp from "sharp";
import { getCV } from "./index.js";
import type { OcrRegion } from "./SegmentationEngine.js";

export interface RefinedRegion extends OcrRegion {
  refinedBubblePolygon?: [number, number][];
}

export async function refineBubblePolygons(
  imgBuf: Buffer,
  regions: OcrRegion[]
): Promise<RefinedRegion[]> {
  if (regions.length === 0) return [];

  const cv = getCV();

  const { data: rawData, info } = await sharp(imgBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;

  const rgbaMat = new cv.Mat(H, W, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(rawData));   // safe copy

  const grayMat = new cv.Mat();
  cv.cvtColor(rgbaMat, grayMat, cv.COLOR_RGBA2GRAY);
  rgbaMat.delete();

  const blurred = new cv.Mat();
  cv.GaussianBlur(grayMat, blurred, new cv.Size(5, 5), 0);
  grayMat.delete();

  const edges = new cv.Mat();
  cv.Canny(blurred, edges, 40, 120, 3, false);
  blurred.delete();

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  edges.delete();
  hierarchy.delete();

  const nContours = contours.size();

  // Track which contours have already been assigned to a region.
  // Prevents two close regions from both matching the same large contour.
  const usedContourIndices = new Set<number>();

  const results: RefinedRegion[] = [];

  for (const region of regions) {
    const hint = region.bubblePolygon ?? region.polygon;
    if (!hint || hint.length < 3) {
      results.push({ ...region });
      continue;
    }

    const hXs = hint.map(([nx]) => nx * W);
    const hYs = hint.map(([, ny]) => ny * H);
    const hx1 = Math.min(...hXs);
    const hy1 = Math.min(...hYs);
    const hx2 = Math.max(...hXs);
    const hy2 = Math.max(...hYs);
    const hArea = Math.max(1, (hx2 - hx1) * (hy2 - hy1));

    // Skip tiny regions — too small to have a reliable contour match.
    if (hArea < 400) {
      results.push({ ...region });
      continue;
    }

    // Hint centroid (pixel coords) — used for spatial containment check.
    const hCx = (hx1 + hx2) / 2;
    const hCy = (hy1 + hy2) / 2;

    let bestIdx = -1;
    let bestIOU = 0;

    for (let i = 0; i < nContours; i++) {
      // Skip contours already claimed by an earlier region.
      if (usedContourIndices.has(i)) continue;

      const c = contours.get(i);
      const cArea = cv.contourArea(c);
      if (cArea < 200 || cArea > W * H * 0.4) continue;

      const rect = cv.boundingRect(c);
      const cx1 = rect.x;
      const cy1 = rect.y;
      const cx2 = rect.x + rect.width;
      const cy2 = rect.y + rect.height;
      const cBboxArea = rect.width * rect.height;

      // Spatial containment: the hint's centroid must lie inside the
      // contour's bounding rect.  This rejects distant panel borders that
      // happen to have a non-zero IOU due to proximity at the image edge.
      if (hCx < cx1 || hCx > cx2 || hCy < cy1 || hCy > cy2) continue;

      const ix1 = Math.max(hx1, cx1);
      const iy1 = Math.max(hy1, cy1);
      const ix2 = Math.min(hx2, cx2);
      const iy2 = Math.min(hy2, cy2);
      const interArea = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
      const unionArea = hArea + cBboxArea - interArea;
      const iou = interArea / Math.max(unionArea, 1);

      if (iou > bestIOU) {
        bestIOU = iou;
        bestIdx = i;
      }
    }

    // IOU threshold raised from 0.20 → 0.30 for stronger matching.
    if (bestIdx >= 0 && bestIOU >= 0.30) {
      // Mark this contour as used so no later region can claim it.
      usedContourIndices.add(bestIdx);

      const best = contours.get(bestIdx);
      const approx = new cv.Mat();
      const perimeter = cv.arcLength(best, true);
      cv.approxPolyDP(best, approx, 0.025 * perimeter, true);

      const nPts = approx.rows;
      if (nPts >= 4 && nPts <= 12) {
        const pts: [number, number][] = [];
        for (let j = 0; j < nPts; j++) {
          pts.push([
            Math.max(0, Math.min(1, approx.data32S[j * 2] / W)),
            Math.max(0, Math.min(1, approx.data32S[j * 2 + 1] / H)),
          ]);
        }
        results.push({ ...region, refinedBubblePolygon: pts });
      } else {
        results.push({ ...region });
      }
      approx.delete();
    } else {
      results.push({ ...region });
    }
  }

  contours.delete();

  return results;
}
