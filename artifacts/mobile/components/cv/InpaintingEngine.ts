/**
 * InpaintingEngine (client-side)
 *
 * Calls the server-side /api/cv-pipeline endpoint which orchestrates:
 *   SegmentationEngine → BubbleDetectionEngine → InpaintingEngine (OpenCV Telea)
 *
 * Returns the inpainted image as a base64 PNG string and the set of
 * server-refined bubble polygons for each region.
 *
 * Designed to be called once per manga page when translation regions arrive.
 * Results should be cached by the caller (e.g. using the translationQueue
 * cache key) to avoid duplicate server round-trips for the same page.
 */

export interface CvRegionInput {
  polygon: [number, number][];
  /** Gemini glyph mask, normalized from 0 to 1000 as [x,y] points. */
  mask?: [number, number][];
  bubblePolygon?: [number, number][];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CvRefinedRegion extends CvRegionInput {
  refinedBubblePolygon?: [number, number][];
}

export interface CVPipelineResult {
  inpaintedImage: string;
  refinedRegions: CvRefinedRegion[];
  width: number;
  height: number;
}

export interface CVPipelineOptions {
  removalMode?: "inpaint" | "overlay";
  maskPadding?: number;
  preserveBubbleBorders?: boolean;
}

const PIPELINE_TIMEOUT_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run the full CV pipeline for one manga page.
 *
 * @param imageUrl   CDN URL of the source manga page.
 * @param regions    OCR regions from Gemini (polygon + optional bubblePolygon).
 * @param apiBase    Base URL for the API server.  Defaults to "/api" (proxy).
 */
export async function runCVPipeline(
  imageUrl: string,
  regions: CvRegionInput[],
  apiBase = "/api",
  options: CVPipelineOptions = {},
): Promise<CVPipelineResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiBase}/cv-pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl, regions, options }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch {}
      throw new Error(`CV pipeline failed: ${detail}`);
    }

    const data = await res.json() as CVPipelineResult;
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run CV pipeline with automatic retry on transient server errors (503/502).
 * Returns null on non-recoverable failure — caller should fall back to the
 * existing SVG overlay renderer.
 */
export async function runCVPipelineWithRetry(
  imageUrl: string,
  regions: CvRegionInput[],
  apiBase = "/api",
  maxAttempts = 2,
  options: CVPipelineOptions = {},
): Promise<CVPipelineResult | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runCVPipeline(imageUrl, regions, apiBase, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[CVPipeline] attempt ${attempt} failed: ${msg}`);
      if (attempt < maxAttempts) {
        await sleep(1500 * attempt);
      }
    }
  }
  return null;
}
