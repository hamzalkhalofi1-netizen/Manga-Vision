import { Image } from "expo-image";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, View } from "react-native";
import PremiumOverlayRenderer from "./PremiumOverlayRenderer";
import CVPipelineRenderer from "./CVPipelineRenderer";
import { runCVPipelineWithRetry, type CvRefinedRegion, type CvRegionInput } from "./cv/InpaintingEngine";
import { classifyRegion } from "./cv/TextClassificationEngine";
import { getBasicImageHeaders } from "@/services/sourceImageHeaders";

const SCREEN_W = Dimensions.get("window").width;
const DEFAULT_ASPECT = 1.45;

/**
 * A 4-point polygon in normalized [0,1] image coordinates.
 * Order: top-left, top-right, bottom-right, bottom-left (clockwise).
 */
export type BubblePolygon = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export interface TextRegion {
  original: string;
  translated: string;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX?: number;
  centerY?: number;
  centroid?: { x: number; y: number };
  rotation?: number;
  polygon?: BubblePolygon;
  bubblePolygon?: [number, number][];
  /** "speech" | "thought" | "sfx" | "sign" | "narration" | "title" | "credits" | "watermark" */
  type: string;
  bgColor: string;
  textColor: string;
  speaker: string | null;
  emphasis: boolean;
}

interface CVState {
  inpaintedUri: string;
  /** Aligned to regions[]. null for regions that were not inpainted. */
  refinedRegions: (CvRefinedRegion | null)[];
}

interface MangaPageProps {
  uri: string;
  regions?: TextRegion[];
  showOverlay: boolean;
  isRTL?: boolean;
  onHeightKnown?: (height: number) => void;
  sourceId?: string;
}

function MangaPage({
  uri,
  regions = [],
  showOverlay,
  isRTL = false,
  onHeightKnown,
  sourceId,
}: MangaPageProps) {
  const imageHeaders = sourceId ? getBasicImageHeaders(sourceId) : undefined;
  const [displayH, setDisplayH] = useState(Math.round(SCREEN_W * DEFAULT_ASPECT));
  const [nativeDims, setNativeDims] = useState({ w: 0, h: 0 });

  const [cvState, setCvState] = useState<CVState | null>(null);
  const [cvLoading, setCvLoading] = useState(false);
  const cvRunRef = useRef<string | null>(null);

  useEffect(() => {
    if (!showOverlay || regions.length === 0) {
      setCvState(null);
      setCvLoading(false);
      cvRunRef.current = null;
      return;
    }

    const runKey = `${uri}|${regions.length}`;
    if (cvRunRef.current === runKey) return;
    cvRunRef.current = runKey;

    setCvLoading(true);
    setCvState(null);

    // ── Classify every region before touching the CV pipeline ─────────────
    // Only regions that need inpainting (speech bubbles, narration, sfx, signs)
    // are sent to the server.  Chapter titles, credits, and watermarks are
    // skipped entirely — they don't need server processing and should not
    // be rendered.
    const inpaintIndices: number[] = [];
    const cvRegions: CvRegionInput[] = [];

    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const cls = classifyRegion(r);
      if (!cls.shouldInpaint) continue;

      inpaintIndices.push(i);
      cvRegions.push({
        polygon: r.polygon ?? [
          [r.x, r.y],
          [r.x + r.w, r.y],
          [r.x + r.w, r.y + r.h],
          [r.x, r.y + r.h],
        ],
        bubblePolygon: r.bubblePolygon,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
      });
    }

    if (cvRegions.length === 0) {
      setCvLoading(false);
      return;
    }

    runCVPipelineWithRetry(uri, cvRegions)
      .then((result) => {
        if (!result) return;
        if (cvRunRef.current !== runKey) return;

        // Re-align refinedRegions back to original region indices
        const fullRefined: (CvRefinedRegion | null)[] = new Array(regions.length).fill(null);
        result.refinedRegions.forEach((refined, pipelineIdx) => {
          const originalIdx = inpaintIndices[pipelineIdx];
          if (originalIdx !== undefined) {
            fullRefined[originalIdx] = refined;
          }
        });

        setCvState({
          inpaintedUri: `data:image/png;base64,${result.inpaintedImage}`,
          refinedRegions: fullRefined,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (cvRunRef.current === runKey) setCvLoading(false);
      });
  }, [uri, regions, showOverlay]);

  const handleLoad = useCallback(
    (e: { source: { width: number; height: number } }) => {
      const { width, height } = e.source;
      if (width > 0 && height > 0) {
        const h = Math.round(SCREEN_W * (height / width));
        setDisplayH(h);
        setNativeDims({ w: width, h: height });
        onHeightKnown?.(h);
      }
    },
    [onHeightKnown]
  );

  const imageSource = cvState?.inpaintedUri
    ? { uri: cvState.inpaintedUri }
    : { uri, headers: imageHeaders };

  return (
    <View style={{ width: SCREEN_W, height: displayH, backgroundColor: "#000" }}>
      <Image
        source={imageSource}
        style={{ width: SCREEN_W, height: displayH }}
        contentFit="fill"
        transition={100}
        recyclingKey={cvState?.inpaintedUri ?? uri}
        onLoad={handleLoad}
      />

      {showOverlay && cvState && regions.length > 0 && (
        <CVPipelineRenderer
          regions={regions}
          refinedRegions={cvState.refinedRegions}
          displayW={SCREEN_W}
          displayH={displayH}
        />
      )}

      {showOverlay && !cvState && regions.length > 0 && !cvLoading && (
        <PremiumOverlayRenderer
          regions={regions}
          displayW={SCREEN_W}
          displayH={displayH}
          nativeW={nativeDims.w}
          nativeH={nativeDims.h}
          isRTL={isRTL}
          imageUri={uri}
        />
      )}

      {showOverlay && cvLoading && (
        <View
          style={{ position: "absolute", top: 6, right: 8, opacity: 0.6 }}
          pointerEvents="none"
        >
          <ActivityIndicator size="small" color="#7B96FF" />
        </View>
      )}
    </View>
  );
}

export default memo(MangaPage);
