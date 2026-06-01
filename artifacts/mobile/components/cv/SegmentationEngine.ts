/**
 * SegmentationEngine (client-side)
 *
 * Client-side text mask utilities.  On web, samples actual pixel data from
 * a Canvas 2D context to build per-region TextMask descriptors that can be
 * visualised or forwarded to the server pipeline.  On native, returns
 * null (server-side OpenCV handles all segmentation).
 *
 * Mask quality scoring:
 *   Each polygon region is scored by sampling pixels inside the polygon and
 *   counting "ink" pixels (luminance < 0.15).  A high ink ratio means the
 *   OCR polygon is well-aligned with actual text; a low ratio suggests the
 *   Gemini polygon drifted outside the glyph boundary.
 */

import { Platform } from "react-native";

export interface TextMask {
  regionIndex: number;
  polygon: [number, number][];
  inkRatio: number;
  width: number;
  height: number;
}

function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function pointInPolygon(
  px: number,
  py: number,
  poly: [number, number][]
): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

async function getImageCanvas(
  imageUrl: string
): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        try { ctx.getImageData(0, 0, 1, 1); } catch { resolve(null); return; }
        resolve(canvas);
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Build TextMask descriptors for a set of OCR polygons on the web platform.
 * Returns null on native (server handles segmentation).
 */
export async function buildClientMasks(
  imageUrl: string,
  polygons: [number, number][][]
): Promise<TextMask[] | null> {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;

  const canvas = await getImageCanvas(imageUrl);
  if (!canvas) return null;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const W = canvas.width;
  const H = canvas.height;
  const masks: TextMask[] = [];

  for (let idx = 0; idx < polygons.length; idx++) {
    const poly = polygons[idx];
    if (poly.length < 3) continue;

    const xs = poly.map(([nx]) => nx * W);
    const ys = poly.map(([, ny]) => ny * H);
    const minX = Math.max(0, Math.floor(Math.min(...xs)) - 2);
    const minY = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    const maxX = Math.min(W - 1, Math.ceil(Math.max(...xs)) + 2);
    const maxY = Math.min(H - 1, Math.ceil(Math.max(...ys)) + 2);

    const sw = maxX - minX;
    const sh = maxY - minY;
    if (sw <= 0 || sh <= 0) continue;

    let pixelData: ImageData;
    try {
      pixelData = ctx.getImageData(minX, minY, sw, sh);
    } catch {
      continue;
    }

    let inkCount = 0;
    let totalCount = 0;
    const { data } = pixelData;

    for (let row = 0; row < sh; row++) {
      for (let col = 0; col < sw; col++) {
        const px = (minX + col) / W;
        const py = (minY + row) / H;
        if (!pointInPolygon(px, py, poly)) continue;

        const i = (row * sw + col) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = luminance(r, g, b);
        totalCount++;
        if (lum < 0.15) inkCount++;
      }
    }

    masks.push({
      regionIndex: idx,
      polygon: poly,
      inkRatio: totalCount > 0 ? inkCount / totalCount : 0,
      width: W,
      height: H,
    });
  }

  return masks;
}
