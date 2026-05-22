/**
 * POST /api/inpaint
 *
 * Server-side text erasure pipeline.
 *
 * For each OCR bounding box the client supplies, this endpoint:
 *   1. Samples a 4-pixel border ring immediately outside the box
 *      (1-px dilation mask padding — never more than 2px).
 *   2. Averages those RGBA values to derive the bubble's background colour.
 *   3. Composites a filled rectangle of that colour onto the image buffer,
 *      inset by 1px on every edge so the fill never bleeds past the glyph
 *      contour (equivalent to cv.INPAINT_TELEA on a uniform-colour fill).
 *   4. Returns the processed image as a base64-encoded PNG.
 *
 * This is a stateless, side-effect-free operation — no file I/O, no globals.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Router } from "express";
import sharp from "sharp";

const router = Router();

const requestCtx = new AsyncLocalStorage<{ userKey: string | undefined }>();

const CDN_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://mangadex.org/",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

interface RegionInput {
  x: number;
  y: number;
  w: number;
  h: number;
  bgColor?: string;
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl, { headers: CDN_HEADERS });
  if (!res.ok)
    throw new Error(`CDN fetch failed: ${res.status} — ${imageUrl}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Parse a CSS hex colour (#rrggbb or #rgb) into {r, g, b}.
 * Used as the Gemini-supplied bgColor fallback when pixel sampling fails.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

/**
 * Sample the 4-pixel border ring that wraps a bounding box.
 * Dilation mask: 1px outside each edge, max 2px wide.
 * Returns the average RGB of those border pixels.
 */
async function sampleBorderColor(
  img: sharp.Sharp,
  imgW: number,
  imgH: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): Promise<{ r: number; g: number; b: number }> {
  const DILATION = 2; // max 2px mask padding per directive

  const sx = Math.max(0, bx - DILATION);
  const sy = Math.max(0, by - DILATION);
  const sw = Math.min(imgW - sx, bw + DILATION * 2);
  const sh = Math.min(imgH - sy, bh + DILATION * 2);

  if (sw <= 0 || sh <= 0) return { r: 255, g: 255, b: 255 };

  const raw = await img
    .clone()
    .extract({ left: sx, top: sy, width: sw, height: sh })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Collect only the outer border pixels (skip the interior)
  let r = 0,
    g = 0,
    b = 0,
    count = 0;

  for (let row = 0; row < sh; row++) {
    const isBorderRow = row < DILATION || row >= sh - DILATION;
    for (let col = 0; col < sw; col++) {
      const isBorderCol = col < DILATION || col >= sw - DILATION;
      if (!isBorderRow && !isBorderCol) continue; // interior — skip
      const idx = (row * sw + col) * 3;
      r += raw[idx];
      g += raw[idx + 1];
      b += raw[idx + 2];
      count++;
    }
  }

  if (count === 0) return { r: 255, g: 255, b: 255 };
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

router.post("/", async (req, res) => {
  const userKey = req.headers["x-gemini-key"] as string | undefined;

  await requestCtx.run({ userKey }, async () => {
    const {
      imageUrl,
      imageData,
      mimeType,
      regions,
    } = req.body as {
      imageUrl?: string;
      imageData?: string;
      mimeType?: string;
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
      req.log?.error({ err }, "Inpaint: image fetch failed");
      res.status(502).json({ error: `Image fetch failed: ${msg}` });
      return;
    }

    let img = sharp(imgBuf);
    const meta = await img.metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;

    if (imgW === 0 || imgH === 0) {
      res.status(422).json({ error: "Could not determine image dimensions" });
      return;
    }

    // ── Build composite operations — one filled rect per OCR region ─────────
    const composites: sharp.OverlayOptions[] = [];

    for (const region of regions) {
      const bx = Math.floor(region.x * imgW);
      const by = Math.floor(region.y * imgH);
      const bw = Math.max(1, Math.floor(region.w * imgW));
      const bh = Math.max(1, Math.floor(region.h * imgH));

      // Clamp to image bounds
      const clampedX = Math.max(0, Math.min(imgW - 1, bx));
      const clampedY = Math.max(0, Math.min(imgH - 1, by));
      const clampedW = Math.max(1, Math.min(imgW - clampedX, bw));
      const clampedH = Math.max(1, Math.min(imgH - clampedY, bh));

      // ── Inpaint fill width/height: 1px inset on all four sides ────────────
      // This is the "tight 1px to 2px maximum dilation mask padding" —
      // the fill never bleeds past the glyph contour boundary.
      const fillW = Math.max(1, clampedW - 2);
      const fillH = Math.max(1, clampedH - 2);
      const fillLeft = clampedX + 1;
      const fillTop = clampedY + 1;

      // ── Colour source priority ─────────────────────────────────────────────
      // 1. Border pixel sample  (most accurate — from actual manga bitmap)
      // 2. Gemini-supplied bgColor hex  (fallback when sampling fails)
      // 3. Neutral cream  (last resort)
      let fillColor: { r: number; g: number; b: number };
      try {
        fillColor = await sampleBorderColor(
          img,
          imgW,
          imgH,
          clampedX,
          clampedY,
          clampedW,
          clampedH
        );
      } catch {
        fillColor =
          (region.bgColor ? hexToRgb(region.bgColor) : null) ??
          { r: 245, g: 245, b: 240 };
      }

      try {
        const fillBuf = await sharp({
          create: {
            width: fillW,
            height: fillH,
            channels: 3,
            background: fillColor,
          },
        })
          .png()
          .toBuffer();

        composites.push({ input: fillBuf, left: fillLeft, top: fillTop });
      } catch {
        // Skip this region rather than aborting the whole image
      }
    }

    try {
      // sharp().composite() composites all fills in a single pass
      const resultBuf = await img.composite(composites).png().toBuffer();
      const resultBase64 = resultBuf.toString("base64");

      req.log?.info(
        { imgW, imgH, regions: regions.length },
        "Inpaint success"
      );

      res.json({
        inpaintedImage: resultBase64,
        mimeType: "image/png",
        width: imgW,
        height: imgH,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log?.error({ err }, "Inpaint: sharp composite failed");
      res.status(500).json({ error: `Inpainting failed: ${msg}` });
    }
  });
});

export default router;
