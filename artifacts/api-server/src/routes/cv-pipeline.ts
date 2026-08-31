/**
 * POST /api/cv-pipeline
 *
 * Full computer-vision image processing pipeline for manga localization.
 *
 * Stage 1 — Text Segmentation (SegmentationEngine):
 *   Adaptive Gaussian thresholding isolates actual text ink pixels within
 *   each OCR polygon boundary.  Morphological dilation (3×3, 2 iterations)
 *   catches edge pixels.  Output: full-image binary mask.
 *
 * Stage 2 — Bubble Detection (BubbleDetectionEngine):
 *   Canny edge detection + findContours + approxPolyDP refines Gemini's
 *   bubble polygon hints using actual structural edges in the image.
 *   IOU matching ensures each hint is matched to the closest real contour.
 *
 * Stage 3 — Inpainting (InpaintingEngine):
 *   OpenCV Telea Fast-Marching inpainting (radius=10) reconstructs the
 *   original bubble background behind every removed text glyph.
 *   Bubble borders and surrounding artwork are untouched.
 *
 * Response:
 *   {
 *     inpaintedImage: string,  // base64 PNG
 *     refinedRegions: Array<{
 *       polygon, bubblePolygon, refinedBubblePolygon,
 *       x, y, w, h
 *     }>,
 *     width: number,
 *     height: number
 *   }
 */

import { Router } from "express";
import { buildTextMasks, type OcrRegion } from "../cv/SegmentationEngine.js";
import { inpaintImage } from "../cv/InpaintingEngine.js";
import { refineBubblePolygons } from "../cv/BubbleDetectionEngine.js";

const router = Router();

const CDN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getCdnReferer(imageUrl: string): string {
  const u = imageUrl.toLowerCase();
  if (u.includes("mangafire") || u.includes("azfast") || u.includes("b-cdn.net")) return "https://mangafire.to/";
  if (u.includes("asura") || u.includes("asuracomic")) return "https://asurascans.com/";
  if (u.includes("bato.to") || u.includes("batocdn")) return "https://bato.to/";
  if (u.includes("comick") || u.includes("meo.comick")) return "https://comick.io/";
  if (u.includes("mangaplus") || u.includes("shueisha")) return "https://mangaplus.shueisha.co.jp/";
  if (u.includes("webtoon") || u.includes("naver")) return "https://www.webtoons.com/";
  if (u.includes("chapmanganato") || u.includes("manganato")) return "https://chapmanganato.to/";
  return "https://mangadex.org/";
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent": CDN_UA,
      Referer: getCdnReferer(imageUrl),
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`CDN fetch failed ${res.status}: ${imageUrl}`);
  return Buffer.from(await res.arrayBuffer());
}

interface RegionInput {
  polygon: [number, number][];
  mask?: [number, number][];
  bubblePolygon?: [number, number][];
  x: number;
  y: number;
  w: number;
  h: number;
}

router.post("/", async (req, res) => {
  const { imageUrl, imageData, regions } = req.body as {
    imageUrl?: string;
    imageData?: string;
    regions: RegionInput[];
  };

  if (!imageUrl && !imageData) {
    res.status(400).json({ error: "imageUrl or imageData is required" });
    return;
  }
  if (!Array.isArray(regions) || regions.length === 0) {
    res.status(400).json({ error: "regions[] is required and must not be empty" });
    return;
  }

  let imgBuf: Buffer;
  try {
    imgBuf = imageUrl
      ? await fetchImageBuffer(imageUrl)
      : Buffer.from(imageData!, "base64");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ err }, "cv-pipeline: image fetch failed");
    res.status(502).json({ error: `Image fetch failed: ${msg}` });
    return;
  }

  const ocrRegions: OcrRegion[] = regions.map((r) => ({
    polygon: r.polygon,
    mask: r.mask,
    bubblePolygon: r.bubblePolygon,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
  }));

  try {
    // ── Stage 1: Text Segmentation ──────────────────────────────────────────
    req.log?.info({ regions: regions.length }, "cv-pipeline: stage 1 — segmentation");
    const { maskData, width, height, maskPixels, regionDiagnostics } =
      await buildTextMasks(imgBuf, ocrRegions);
    req.log?.info(
      {
        width,
        height,
        maskWidth: width,
        maskHeight: height,
        maskPixels,
        regionDiagnostics,
      },
      "cv-pipeline: mask ready",
    );

    // ── Stage 2: Bubble Detection ───────────────────────────────────────────
    req.log?.info("cv-pipeline: stage 2 — bubble detection");
    const refinedRegions = await refineBubblePolygons(imgBuf, ocrRegions);

    // ── Stage 3: Inpainting ─────────────────────────────────────────────────
    req.log?.info("cv-pipeline: stage 3 — inpainting");
    const { imageBuffer } = await inpaintImage(imgBuf, maskData, width, height);

    const inpaintedImage = imageBuffer.toString("base64");

    req.log?.info(
      {
        width,
        height,
        regions: regions.length,
        maskPixels,
        inpaintedBytes: imageBuffer.length,
      },
      "cv-pipeline: complete"
    );

    res.json({
      inpaintedImage,
      refinedRegions,
      width,
      height,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ err }, "cv-pipeline: processing failed");
    res.status(500).json({ error: `CV pipeline failed: ${msg}` });
  }
});

export default router;
