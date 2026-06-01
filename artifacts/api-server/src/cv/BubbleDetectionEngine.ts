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
 *        a. Compute IOU between contour bounding boxes and hint bbox.
 *        b. Best-matching contour with IOU ≥ 0.20 is selected.
 *        c. approxPolyDP at 2.5% perimeter → simplified polygon.
 *        d. Accept if 4–12 vertices, normalize to [0,1].
 *        e. Fall back to Gemini bubblePolygon or polygon if no match.
 *
 * The 0.20 IOU minimum is intentionally permissive.  Manga bubble borders
 * are often single-pixel-wide and soft, producing incomplete contours.
 * A partial overlap is sufficient to identify the correct structural contour.
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
  rgbaMat.data.set(new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.length));

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

    if (hArea < 400) {
      results.push({ ...region });
      continue;
    }

    let bestIdx = -1;
    let bestIOU = 0;

    for (let i = 0; i < nContours; i++) {
      const c = contours.get(i);
      const cArea = cv.contourArea(c);
      if (cArea < 200 || cArea > W * H * 0.4) continue;

      const rect = cv.boundingRect(c);
      const cx1 = rect.x;
      const cy1 = rect.y;
      const cx2 = rect.x + rect.width;
      const cy2 = rect.y + rect.height;
      const cBboxArea = rect.width * rect.height;

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

    if (bestIdx >= 0 && bestIOU >= 0.20) {
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
