/**
 * SegmentationEngine — glyph-focused ink-pixel mask builder.
 *
 * Generates a binary text-pixel mask from actual image data so that
 * InpaintingEngine can reconstruct the bubble background behind removed glyphs.
 *
 * Pipeline (per call):
 *   1. Decode RGBA via sharp → copy into OpenCV BGR → grayscale.
 *   2. For each OCR region, rasterize the tight text polygon and expand it
 *      by a small, resolution-aware pixel margin.
 *   3. Optionally union the detected ink pixels inside that expanded region.
 *      The expanded text shape is deliberately included in full: text can be
 *      white, outlined, coloured, or otherwise invisible to a dark-ink
 *      threshold, and leaving those pixels behind is worse than inpainting the
 *      small amount of background between glyphs.
 *   4. OR all per-region masks into one full-image accumulator.
 *
 * `bubblePolygon` is never used as the removal boundary. It describes the full
 * bubble for text placement and may be much larger than the text. Using it for
 * erasure was the regression that caused large/X-shaped masks and still did not
 * reliably remove decorated glyphs.
 *
 * CRITICAL — memory safety:
 *   OpenCV WASM Mats live on the WASM heap.  `Buffer.from(mat.data.buffer,
 *   byteOffset, length)` creates a ZERO-COPY VIEW into that heap.  After
 *   mat.delete() the WASM heap slot is freed; any later read of the Buffer
 *   returns zeros (or garbage) — silently breaking all downstream stages.
 *   We always use `Buffer.from(mat.data)` which COPIES the Uint8ClampedArray
 *   into a fresh Node.js heap Buffer before the Mat is deleted.
 */

import sharp from "sharp";
import { getCV } from "./index.js";

export interface OcrRegion {
  /** Tight OCR polygon in normalized [0,1] image coordinates. */
  polygon?: [number, number][];
  /** Gemini segmentation polygon in normalized [0,1000] coordinates. */
  mask?: [number, number][];
  bubblePolygon?: [number, number][];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SegmentationResult {
  maskData: Buffer;
  width: number;
  height: number;
  maskPixels: number;
  regionDiagnostics: Array<{
    index: number;
    normalizedPolygon: [number, number][];
    pixelBounds: { x: number; y: number; width: number; height: number };
    paddingPx: number;
  }>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function getTightPolygon(region: OcrRegion): [number, number][] {
  if (region.mask && region.mask.length >= 3) {
    const maskUsesThousandScale = region.mask.some(([x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1);
    return region.mask.map(([x, y]) => [
      clamp01(maskUsesThousandScale ? x / 1000 : x),
      clamp01(maskUsesThousandScale ? y / 1000 : y),
    ]);
  }

  if (region.polygon && region.polygon.length >= 3) {
    return region.polygon.map(([x, y]) => [clamp01(x), clamp01(y)]);
  }

  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const w = Math.max(0, Math.min(1 - x, Number.isFinite(region.w) ? region.w : 0));
  const h = Math.max(0, Math.min(1 - y, Number.isFinite(region.h) ? region.h : 0));
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export async function buildTextMasks(
  imgBuf: Buffer,
  regions: OcrRegion[]
): Promise<SegmentationResult> {
  const cv = getCV();

  const { data: rawData, info } = await sharp(imgBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;

  // Use new Uint8Array(rawData) to COPY the Node.js Buffer's bytes — this
  // is safe regardless of whether the Buffer shares an internal pool with a
  // non-zero byteOffset.
  const rgbaMat = new cv.Mat(H, W, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(rawData));

  const bgrMat = new cv.Mat();
  cv.cvtColor(rgbaMat, bgrMat, cv.COLOR_RGBA2BGR);
  rgbaMat.delete();

  const grayMat = new cv.Mat();
  cv.cvtColor(bgrMat, grayMat, cv.COLOR_BGR2GRAY);
  bgrMat.delete();

  // Keep a thresholded ink mask as a diagnostic/quality aid. The removal
  // boundary below is the expanded OCR shape, not this threshold, because
  // thresholding cannot see white or outlined lettering.
  const threshMat = new cv.Mat();
  cv.adaptiveThreshold(
    grayMat, threshMat, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV,
    15, 2
  );
  grayMat.delete();

  const fullMask = cv.Mat.zeros(H, W, cv.CV_8UC1);

  const regionDiagnostics: SegmentationResult["regionDiagnostics"] = [];

  regions.forEach((region, index) => {
    const maskPoly = getTightPolygon(region);
    if (maskPoly.length < 3) return;

    const pxCoords = maskPoly.map(([nx, ny]) => [
      Math.max(0, Math.min(W - 1, Math.round(nx * W))),
      Math.max(0, Math.min(H - 1, Math.round(ny * H))),
    ]);
    const xs = pxCoords.map(([x]) => x);
    const ys = pxCoords.map(([, y]) => y);
    const boxWidth = Math.max(1, Math.max(...xs) - Math.min(...xs));
    const boxHeight = Math.max(1, Math.max(...ys) - Math.min(...ys));
    // A small margin catches antialiased outlines and glyph pixels just
    // outside Gemini's tight box without touching the bubble border. It is
    // based on the short side so vertical/horizontal text behave equally.
    const paddingPx = Math.max(
      2,
      Math.min(10, Math.round(Math.min(boxWidth, boxHeight) * 0.14)),
    );
    const flat = pxCoords.flatMap(([x, y]) => [x, y]);

    const polyMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
    const contourMat = cv.matFromArray(pxCoords.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(contourMat);
    cv.fillPoly(polyMask, vec, new cv.Scalar(255), cv.LINE_8);
    vec.delete();
    contourMat.delete();

    // Dilating the filled text shape (rather than only thresholded ink)
    // creates one complete mask for every glyph, including pale/outlined
    // characters. A 3×3 kernel adds one pixel per iteration.
    const expandedMask = new cv.Mat();
    const expandKernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(
      polyMask,
      expandedMask,
      expandKernel,
      new cv.Point(-1, -1),
      paddingPx,
    );
    expandKernel.delete();

    // Keep the threshold intersection in the union for future diagnostics;
    // the expanded polygon is the authoritative removal mask.
    const regionInk = new cv.Mat();
    cv.bitwise_and(threshMat, expandedMask, regionInk);
    cv.bitwise_or(expandedMask, regionInk, expandedMask);
    regionInk.delete();
    polyMask.delete();

    cv.bitwise_or(fullMask, expandedMask, fullMask);
    expandedMask.delete();

    regionDiagnostics.push({
      index,
      normalizedPolygon: maskPoly,
      pixelBounds: {
        x: Math.max(0, Math.min(...xs) - paddingPx),
        y: Math.max(0, Math.min(...ys) - paddingPx),
        width: Math.min(W, Math.max(...xs) + paddingPx) -
          Math.max(0, Math.min(...xs) - paddingPx),
        height: Math.min(H, Math.max(...ys) + paddingPx) -
          Math.max(0, Math.min(...ys) - paddingPx),
      },
      paddingPx,
    });
  });

  threshMat.delete();

  // SAFE copy: Buffer.from(typedArray) copies the data into a new
  // Node.js Buffer that does NOT reference the WASM heap.
  // mat.delete() can then safely free the WASM slot.
  const maskData = Buffer.from(fullMask.data);
  const maskPixels = cv.countNonZero(fullMask);
  fullMask.delete();

  return {
    maskData,
    width: W,
    height: H,
    maskPixels,
    regionDiagnostics,
  };
}
