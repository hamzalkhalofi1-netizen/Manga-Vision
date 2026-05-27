/**
 * BubbleColorSampler
 *
 * Samples actual pixel colors from a manga image at OCR polygon locations
 * to obtain the true local bubble background color for mask filling.
 *
 * ── Platform behaviour ────────────────────────────────────────────────────────
 *
 * Web:    Draws the image to a hidden Canvas 2D context and samples pixel
 *         data at multiple points inside the OCR polygon.  Returns the median
 *         of "light, low-saturation" pixels — skipping ink (dark) and panel
 *         borders (very dark or very high contrast).
 *
 *         Cross-origin note: CDN images may block canvas access (CORS).
 *         The function handles SecurityError gracefully and returns null,
 *         letting the caller fall back to the Gemini-provided bgColor.
 *
 * Native: React Native has no DOM Canvas API.  Returns null immediately so
 *         the caller uses the Gemini bgColor + adaptive opacity system instead.
 *
 * ── Sample strategy ───────────────────────────────────────────────────────────
 *
 * For each polygon we sample:
 *   • polygon centroid (1 point)
 *   • 4 inner offset points at ±25% of polygon bbox extent from centroid
 *   • A 7×7 pixel area around each point (up to 49 raw pixels per sample pt)
 *
 * Pixel filter — skip pixels that are:
 *   • luminance < 0.12  → dark ink, panel borders, shadow areas
 *   • luminance > 0.97  → blown-out highlight artefacts
 *   • saturation > 0.55 → coloured panel inserts (not the bubble fill)
 *
 * The median of surviving channels is returned (more robust than mean for
 * an image area that may still contain a few text-adjacent pixels).
 *
 * ── Caching ───────────────────────────────────────────────────────────────────
 *
 * Image canvases are cached by URL so that the first region of a page
 * pays the image-load cost; subsequent regions reuse the cached canvas.
 * The cache is bounded to 10 entries (LRU-style eviction).
 */

import { Platform } from "react-native";

// ── Helpers ───────────────────────────────────────────────────────────────────

function polyCenter(polygon: [number, number][]): { x: number; y: number } {
  let cx = 0, cy = 0;
  for (const [x, y] of polygon) { cx += x; cy += y; }
  return { x: cx / polygon.length, y: cy / polygon.length };
}

/**
 * 5 normalized sample points inside the polygon:
 * centroid + 4 inner offsets at ±25% of bbox half-extent.
 */
function buildSamplePoints(polygon: [number, number][]): { x: number; y: number }[] {
  const center = polyCenter(polygon);
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const hw = (Math.max(...xs) - Math.min(...xs)) * 0.25;
  const hh = (Math.max(...ys) - Math.min(...ys)) * 0.25;

  return [
    { x: center.x,      y: center.y      },
    { x: center.x - hw, y: center.y      },
    { x: center.x + hw, y: center.y      },
    { x: center.x,      y: center.y - hh },
    { x: center.x,      y: center.y + hh },
  ];
}

/** WCAG luminance approximation for a raw 0–255 pixel. */
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** HSV saturation approximation for a 0–255 pixel. */
function saturation(r: number, g: number, b: number): number {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return maxC > 0 ? (maxC - minC) / maxC : 0;
}

// ── Canvas cache (web only) ───────────────────────────────────────────────────

const CACHE_MAX = 10;

/** LRU-bounded canvas cache keyed by image URL. */
const _canvasCache = new Map<string, HTMLCanvasElement | null>();

function evictOldest(): void {
  if (_canvasCache.size >= CACHE_MAX) {
    _canvasCache.delete(_canvasCache.keys().next().value!);
  }
}

/**
 * Returns a Canvas2D context pre-drawn with the given image, or null on
 * CORS failure / load error.  Result is cached by URL.
 */
async function getImageCanvas(
  imageUrl: string,
): Promise<HTMLCanvasElement | null> {
  if (_canvasCache.has(imageUrl)) return _canvasCache.get(imageUrl)!;

  evictOldest();
  _canvasCache.set(imageUrl, null);          // Mark in-flight

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload  = () => resolve();
      img.onerror = () => reject(new Error("img load error"));
      img.src     = imageUrl;
    });

    const canvas  = document.createElement("canvas");
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) { _canvasCache.set(imageUrl, null); return null; }

    ctx.drawImage(img, 0, 0);
    // Trigger a test read to detect CORS taint early
    ctx.getImageData(0, 0, 1, 1);

    _canvasCache.set(imageUrl, canvas);
    return canvas;
  } catch {
    // CORS taint, load failure, or security error — return null
    _canvasCache.set(imageUrl, null);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sample result: the dominant bubble background color in CSS rgb() format,
 * plus the per-channel median values for adaptive blending.
 */
export interface SampledColor {
  /** CSS rgb() string — use as mask fill color */
  rgb: string;
  /** 0–255 channel values for further processing */
  r: number;
  g: number;
  b: number;
  /** WCAG luminance 0–1 */
  luminance: number;
}

/**
 * sampleBubbleColor — samples the dominant bubble background color at a
 * polygon location in the given image.
 *
 * @param imageUrl  Full URL to the manga image (must be accessible).
 * @param polygon   Normalized [0,1] polygon from the OCR pipeline.
 * @returns         Sampled color, or null on native / CORS failure / no valid pixels.
 */
export async function sampleBubbleColor(
  imageUrl: string,
  polygon: [number, number][],
): Promise<SampledColor | null> {
  // Native: no DOM canvas — caller uses Gemini bgColor fallback
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  if (!imageUrl || polygon.length < 3) return null;

  try {
    const canvas = await getImageCanvas(imageUrl);
    if (!canvas) return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const samplePts = buildSamplePoints(polygon);
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];

    for (const pt of samplePts) {
      const px   = Math.round(pt.x * canvas.width);
      const py   = Math.round(pt.y * canvas.height);
      const HALF = 3;              // Sample a 7×7 area
      const x0   = Math.max(0, px - HALF);
      const y0   = Math.max(0, py - HALF);
      const sw   = Math.min(2 * HALF + 1, canvas.width  - x0);
      const sh   = Math.min(2 * HALF + 1, canvas.height - y0);
      if (sw <= 0 || sh <= 0) continue;

      let pixelData: ImageData;
      try {
        pixelData = ctx.getImageData(x0, y0, sw, sh);
      } catch {
        // Canvas tainted by CORS — bail out entirely
        return null;
      }

      const { data } = pixelData;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = luminance(r, g, b);
        const sat = saturation(r, g, b);

        // Skip:
        //   • very dark pixels  (ink, borders)   luminance < 0.12
        //   • blown-out whites  (highlights)      luminance > 0.97
        //   • highly saturated  (coloured panels) saturation > 0.55
        if (lum < 0.12 || lum > 0.97 || sat > 0.55) continue;

        rs.push(r);
        gs.push(g);
        bs.push(b);
      }
    }

    if (rs.length === 0) return null;

    // Median of each channel — more robust than mean for image data
    // with residual ink pixels near the text boundary.
    rs.sort((a, b) => a - b);
    gs.sort((a, b) => a - b);
    bs.sort((a, b) => a - b);
    const mid = Math.floor(rs.length / 2);
    const r = rs[mid], g = gs[mid], b = bs[mid];
    const lum = luminance(r, g, b);

    return { rgb: `rgb(${r},${g},${b})`, r, g, b, luminance: lum };
  } catch {
    return null;
  }
}
