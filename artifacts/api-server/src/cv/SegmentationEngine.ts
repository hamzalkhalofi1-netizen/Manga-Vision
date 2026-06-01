/**
 * SegmentationEngine
 *
 * Generates a binary text-pixel mask from actual image data using adaptive
 * Gaussian thresholding constrained to OCR polygon boundaries.
 *
 * Pipeline:
 *   1. Decode image → raw RGBA via sharp.
 *   2. Convert RGBA → BGR → grayscale in OpenCV.
 *   3. adaptiveThreshold (ADAPTIVE_THRESH_GAUSSIAN_C, THRESH_BINARY_INV,
 *      blockSize=11, C=4) to isolate dark ink pixels.
 *   4. For each OCR polygon:
 *        a. Rasterize polygon onto a binary mask with fillPoly.
 *        b. bitwise_AND with threshold output → ink pixels inside polygon only.
 *        c. Accumulate into full-image mask with bitwise_OR.
 *   5. Morphological dilation (3×3 kernel, 2 iterations) to capture edge pixels
 *      that threshold may have partially clipped.
 *
 * The resulting mask has 255 wherever text ink was detected and 0 everywhere
 * else.  It is passed directly to InpaintingEngine.
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

  const rgbaMat = new cv.Mat(H, W, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.length));

  const bgrMat = new cv.Mat();
  cv.cvtColor(rgbaMat, bgrMat, cv.COLOR_RGBA2BGR);
  rgbaMat.delete();

  const grayMat = new cv.Mat();
  cv.cvtColor(bgrMat, grayMat, cv.COLOR_BGR2GRAY);
  bgrMat.delete();

  const threshMat = new cv.Mat();
  cv.adaptiveThreshold(
    grayMat, threshMat, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV,
    11, 4
  );
  grayMat.delete();

  const fullMask = cv.Mat.zeros(H, W, cv.CV_8UC1);

  for (const region of regions) {
    const poly = region.polygon;
    if (!poly || poly.length < 3) continue;

    const pxCoords = poly.map(([nx, ny]) => [
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

  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(fullMask, fullMask, kernel, new cv.Point(-1, -1), 2);
  kernel.delete();

  const maskData = Buffer.from(
    fullMask.data.buffer,
    fullMask.data.byteOffset,
    fullMask.data.byteLength
  );
  fullMask.delete();

  return { maskData, width: W, height: H };
}
