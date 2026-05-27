/**
 * useRegionColors — async per-region bubble color sampling hook.
 *
 * For each text region in `regions`, fires an async pixel sampling request
 * against the manga image URL.  The result map updates incrementally as each
 * region's color arrives — the component re-renders only once per region, not
 * once for the entire batch.
 *
 * Fallback strategy:
 *   • Web + CORS allowed  → SampledColor with real pixel values
 *   • Web + CORS blocked  → null (caller uses Gemini bgColor)
 *   • Native              → null (caller uses Gemini bgColor)
 *
 * The hook aborts all in-flight sampling when imageUri or regions change,
 * preventing stale colors from a previous page polluting the current one.
 */

import { useState, useEffect, useRef } from "react";
import type { TextRegion } from "./MangaPage";
import { sampleBubbleColor, type SampledColor } from "./BubbleColorSampler";

/** Maps region array index → sampled color (or null if unavailable). */
export type RegionColorMap = Map<number, SampledColor | null>;

export function useRegionColors(
  imageUri: string | undefined,
  regions: TextRegion[],
): RegionColorMap {
  const [colorMap, setColorMap] = useState<RegionColorMap>(new Map());
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    if (!imageUri) {
      setColorMap(new Map());
      return;
    }

    // Invalidate any in-flight sampling from a previous image / region set
    const ctrl = { aborted: false };
    abortRef.current = ctrl;
    setColorMap(new Map());

    regions.forEach((region, idx) => {
      if (!region.polygon || region.polygon.length < 3) return;

      sampleBubbleColor(imageUri, region.polygon)
        .then((color) => {
          if (ctrl.aborted || !color) return;
          setColorMap((prev) => {
            const next = new Map(prev);
            next.set(idx, color);
            return next;
          });
        })
        .catch(() => {/* silently ignore — bgColor fallback handles it */});
    });

    return () => {
      ctrl.aborted = true;
    };
  }, [imageUri, regions]);

  return colorMap;
}
