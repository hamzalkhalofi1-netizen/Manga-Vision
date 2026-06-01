/**
 * InpaintingEngine
 *
 * Reconstructs bubble backgrounds obliterated by text ink using
 * Telea's Fast Marching Method (INPAINT_TELEA).
 *
 * Algorithm:
 *   1. Decode source image → RGBA → BGR.
 *   2. Load the binary mask produced by SegmentationEngine (255 = reconstruct).
 *   3. cv.inpaint(src, mask, dst, radius=10, INPAINT_TELEA)
 *      The FMM propagates surrounding pixel values inward along level lines,
 *      reconstructing the original flat bubble fill behind the removed glyphs.
 *   4. BGR → RGB → raw buffer → sharp PNG encode.
 *
 * Radius selection:
 *   10 px covers the full stroke width of typical manga lettering (6–14 px)
 *   while remaining narrow enough to avoid mixing colours across adjacent
 *   bubble regions.
 *
 * Why Telea over Navier-Stokes:
 *   Manga bubbles have flat, uniform fills.  Telea's geometric propagation
 *   is faster and produces sharper results on flat regions.  NS is better
 *   suited for photographic textures.
 */

import sharp from "sharp";
import { getCV } from "./index.js";

export interface InpaintResult {
  imageBuffer: Buffer;
  width: number;
  height: number;
}

export async function inpaintImage(
  imgBuf: Buffer,
  maskData: Buffer,
  width: number,
  height: number,
  radius = 10
): Promise<InpaintResult> {
  const cv = getCV();

  const { data: rawSrc } = await sharp(imgBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const srcRGBA = new cv.Mat(height, width, cv.CV_8UC4);
  srcRGBA.data.set(new Uint8Array(rawSrc.buffer, rawSrc.byteOffset, rawSrc.length));

  const srcBGR = new cv.Mat();
  cv.cvtColor(srcRGBA, srcBGR, cv.COLOR_RGBA2BGR);
  srcRGBA.delete();

  const maskMat = new cv.Mat(height, width, cv.CV_8UC1);
  maskMat.data.set(new Uint8Array(maskData.buffer, maskData.byteOffset, maskData.length));

  const dst = new cv.Mat();
  cv.inpaint(srcBGR, maskMat, dst, radius, cv.INPAINT_TELEA);
  srcBGR.delete();
  maskMat.delete();

  const resultRGB = new cv.Mat();
  cv.cvtColor(dst, resultRGB, cv.COLOR_BGR2RGB);
  dst.delete();

  const resultRaw = Buffer.from(
    resultRGB.data.buffer,
    resultRGB.data.byteOffset,
    resultRGB.data.byteLength
  );
  resultRGB.delete();

  const imageBuffer = await sharp(resultRaw, {
    raw: { width, height, channels: 3 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return { imageBuffer, width, height };
}
