/**
 * SegmentationEngine — glyph-focused ink-pixel mask builder.
 *
 * Generates a binary text-pixel mask from actual image data so that
 * InpaintingEngine can reconstruct the bubble background behind removed glyphs.
 *
 * Pipeline (per call):
 *   1. Decode RGBA via sharp → copy into OpenCV BGR → grayscale.
 *   2. adaptiveThreshold (GAUSSIAN_C, BINARY_INV, blockSize=15, C=2)
 *      to isolate dark ink pixels.  blockSize=15 is better than 11 for
 *      manga text at typical scan resolutions; C=2 is less aggressive than
 *      C=4 so lightly-inked or anti-aliased characters are not clipped.
 *   3. For each OCR region:
 *        a. Use bubblePolygon (full bubble outline) as mask boundary,
 *           falling back to the tight OCR polygon when absent.
 *           The bubble polygon covers the complete interior including text
 *           near the bubble border that the tight polygon would miss.
 *        b. fillPoly to rasterize the boundary.
 *        c. bitwise_AND with threshold output → ink pixels inside only.
 *        d. bitwise_OR into the full-image accumulator mask.
 *   4. morphologyEx CLOSE (5×5, 1 iter) to bridge gaps between character
 *      strokes so Telea gets a solid connected component to work from.
 *   5. dilate (3×3, 3 iters) to capture anti-aliased edge pixels the
 *      threshold may have partially clipped.
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
  polygon: [number, number][];
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

  // blockSize=15: 15×15 local window — wider than 11×11 so the local mean
  // includes enough of the white bubble background to correctly classify
  // ink pixels as foreground.
  // C=2: threshold = local_mean − 2.  Lower C means more pixels pass as
  // "darker than neighbourhood" — important for light/anti-aliased strokes.
  const threshMat = new cv.Mat();
  cv.adaptiveThreshold(
    grayMat, threshMat, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV,
    15, 2
  );
  grayMat.delete();

  const fullMask = cv.Mat.zeros(H, W, cv.CV_8UC1);

  for (const region of regions) {
    // Prefer bubblePolygon (full bubble outline) over the tight OCR polygon.
    // The bubble polygon covers the complete speech bubble interior — text
    // characters near the bubble border are correctly captured.
    const maskPoly =
      region.bubblePolygon && region.bubblePolygon.length >= 3
        ? region.bubblePolygon
        : region.polygon;

    if (!maskPoly || maskPoly.length < 3) continue;

    const pxCoords = maskPoly.map(([nx, ny]) => [
      Math.max(0, Math.min(W - 1, Math.round(nx * W))),
      Math.max(0, Math.min(H - 1, Math.round(ny * H))),
    ]);
    const flat = pxCoords.flatMap(([x, y]) => [x, y]);

    const polyMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
    const contourMat = cv.matFromArray(pxCoords.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(contourMat);
    cv.fillPoly(polyMask, vec, new cv.Scalar(255), cv.LINE_8);
    vec.delete();
    contourMat.delete();

    const regionInk = new cv.Mat();
    cv.bitwise_and(threshMat, polyMask, regionInk);
    polyMask.delete();

    cv.bitwise_or(fullMask, regionInk, fullMask);
    regionInk.delete();
  }

  threshMat.delete();

  // Morphological CLOSE bridges the inter-stroke gaps within each character
  // so Telea receives a solid connected component instead of scattered dots.
  const closeKernel = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.morphologyEx(
    fullMask, fullMask, cv.MORPH_CLOSE,
    closeKernel, new cv.Point(-1, -1), 1
  );
  closeKernel.delete();

  // Dilation captures anti-aliased edge pixels (3×3, 3 iterations).
  const dilKernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(fullMask, fullMask, dilKernel, new cv.Point(-1, -1), 3);
  dilKernel.delete();

  // SAFE copy: Buffer.from(typedArray) copies the data into a new
  // Node.js Buffer that does NOT reference the WASM heap.
  // mat.delete() can then safely free the WASM slot.
  const maskData = Buffer.from(fullMask.data);
  fullMask.delete();

  return { maskData, width: W, height: H };
}
