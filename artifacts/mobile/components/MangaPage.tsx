import { Image } from "expo-image";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

// ── Diagnostic render counter ──────────────────────────────────────────────────
// Logs every time MangaPage renders and whether the Image is visible or hidden.
// Search for "[MangaPage]" in Metro/device logs to trace flickering.
const _renderCounts = __DEV__ ? new Map<string, number>() : null;
import PremiumOverlayRenderer from "./PremiumOverlayRenderer";
import CVPipelineRenderer from "./CVPipelineRenderer";
import { runCVPipelineWithRetry, type CvRefinedRegion, type CvRegionInput } from "./cv/InpaintingEngine";
import { classifyRegion } from "./cv/TextClassificationEngine";
import { getBasicImageHeaders } from "@/services/sourceImageHeaders";
import { getApiBase } from "@/services/api";
import { recordCvDebug } from "@/services/cvDebugStore";
import { useCachedPageImage } from "@/hooks/useCachedPageImage";

const SCREEN_W = Dimensions.get("window").width;
const DEFAULT_ASPECT = 1.45;

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
  type: string;
  bgColor: string;
  textColor: string;
  speaker: string | null;
  emphasis: boolean;
}

type RenderPath = "idle" | "pending" | "cv" | "fallback";

interface CVState {
  inpaintedUri: string;
  refinedRegions: (CvRefinedRegion | null)[];
  inpaintedBytes: number;
}

interface MangaPageProps {
  uri: string;
  /** 1-based page number shown in the loading placeholder. */
  pageNumber?: number;
  regions?: TextRegion[];
  showOverlay: boolean;
  isRTL?: boolean;
  onHeightKnown?: (height: number) => void;
  sourceId?: string;
}

function MangaPage({
  uri,
  pageNumber,
  regions = [],
  showOverlay,
  isRTL = false,
  onHeightKnown,
  sourceId,
}: MangaPageProps) {
  // Memoised so the object reference is stable across re-renders — prevents
  // useCachedPageImage's load useCallback from recreating every render.
  const imageHeaders = useMemo(
    () => (sourceId ? getBasicImageHeaders(sourceId) : undefined),
    [sourceId]
  );

  const [displayH, setDisplayH] = useState(Math.round(SCREEN_W * DEFAULT_ASPECT));
  const [nativeDims, setNativeDims] = useState({ w: 0, h: 0 });

  // ── Cache-first page image loading ────────────────────────────────────────
  // Resolves `uri` to a locally-cached file:// path (instant on revisit) or
  // downloads it via the concurrency-limited, auto-persisting LRU disk cache.
  const {
    status: pageStatus,
    localUri: pageLocalUri,
    retry: retryPageImage,
    reportRenderError,
    progress: pageProgress,
    retryAttempt,
    retryMax,
  } = useCachedPageImage(uri, imageHeaders);

  const [cvState, setCvState] = useState<CVState | null>(null);
  const [cvLoading, setCvLoading] = useState(false);
  const [renderPath, setRenderPath] = useState<RenderPath>("idle");
  const cvRunRef = useRef<string | null>(null);

  useEffect(() => {
    if (!showOverlay || regions.length === 0) {
      setCvState(null);
      setCvLoading(false);
      setRenderPath("idle");
      cvRunRef.current = null;
      return;
    }

    const runKey = `${uri}|${regions.length}`;
    if (cvRunRef.current === runKey) return;
    cvRunRef.current = runKey;

    setCvLoading(true);
    setCvState(null);
    setRenderPath("pending");

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
      setRenderPath("fallback");
      const _page = uri.slice(-60);
      console.log(`[MangaPage] CV_PIPELINE_USED=false  FALLBACK_RENDERER_USED=true  reason="no inpaintable regions"  page="${_page}"`);
      recordCvDebug({ status: "fallback_no_regions", cvPipelineUsed: false, fallbackRendererUsed: true, apiBase: "", inpaintedImageBytes: 0, error: null, reason: "no inpaintable regions", refinedRegions: null, page: _page });
      return;
    }

    const apiBase =
      Platform.OS === "web"
        ? "/api"
        : `${getApiBase()}`.replace(/\/$/, "") + "/api";

    const _page = uri.slice(-60);
    console.log(
      `[MangaPage] CV_PIPELINE_USED=PENDING` +
      `  apiBase="${apiBase}"` +
      `  regions=${cvRegions.length}` +
      `  page="${_page}"`
    );
    recordCvDebug({ status: "pending", cvPipelineUsed: "pending", fallbackRendererUsed: false, apiBase, inpaintedImageBytes: 0, error: null, reason: null, refinedRegions: null, page: _page });

    runCVPipelineWithRetry(uri, cvRegions, apiBase)
      .then((result) => {
        if (!result) {
          setRenderPath("fallback");
          console.warn(
            `[MangaPage] CV_PIPELINE_USED=false  FALLBACK_RENDERER_USED=true` +
            `  INPAINTED_IMAGE_BYTES=0  reason="null result"` +
            `  page="${_page}"`
          );
          recordCvDebug({ status: "fallback_null", cvPipelineUsed: false, fallbackRendererUsed: true, apiBase, inpaintedImageBytes: 0, error: null, reason: "null result (all retries failed)", refinedRegions: null, page: _page });
          return;
        }
        if (cvRunRef.current !== runKey) return;

        const inpBytes = Math.round((result.inpaintedImage?.length ?? 0) * 3 / 4);
        console.log(
          `[MangaPage] CV_PIPELINE_USED=true  FALLBACK_RENDERER_USED=false` +
          `  INPAINTED_IMAGE_BYTES=${inpBytes}` +
          `  refinedRegions=${result.refinedRegions?.length}` +
          `  apiBase="${apiBase}"` +
          `  page="${_page}"`
        );
        recordCvDebug({ status: "success", cvPipelineUsed: true, fallbackRendererUsed: false, apiBase, inpaintedImageBytes: inpBytes, error: null, reason: null, refinedRegions: result.refinedRegions?.length ?? 0, page: _page });

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
          inpaintedBytes: inpBytes,
        });
        setRenderPath("cv");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setRenderPath("fallback");
        console.error(
          `[MangaPage] CV_PIPELINE_USED=false  FALLBACK_RENDERER_USED=true` +
          `  INPAINTED_IMAGE_BYTES=0` +
          `  error="${msg}"` +
          `  apiBase="${apiBase}"` +
          `  page="${_page}"`
        );
        recordCvDebug({ status: "fallback_error", cvPipelineUsed: false, fallbackRendererUsed: true, apiBase, inpaintedImageBytes: 0, error: msg, reason: null, refinedRegions: null, page: _page });
      })
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
        // Only update nativeDims if dimensions actually changed — prevents
        // creating a new object reference on every load, which would cause
        // an unnecessary re-render of MangaPage.
        setNativeDims((prev) =>
          prev.w === width && prev.h === height ? prev : { w: width, h: height }
        );
        onHeightKnown?.(h);
      }
    },
    [onHeightKnown]
  );

  // Memoize rawImageSource so expo-image receives a stable object reference
  // across re-renders. Without this, a new { uri: pageLocalUri } object is
  // created on every render even when the URI hasn't changed, potentially
  // causing expo-image to perform unnecessary reload work.
  const rawImageSource = useMemo(
    () =>
      Platform.OS !== "web" && pageLocalUri
        ? { uri: pageLocalUri }
        : { uri, headers: imageHeaders },
    [pageLocalUri, uri, imageHeaders]
  );

  const imageSource = useMemo(
    () =>
      cvState?.inpaintedUri ? { uri: cvState.inpaintedUri } : rawImageSource,
    [cvState, rawImageSource]
  );

  // Stable recycling key — only changes when the actual content source changes.
  const recyclingKey = cvState?.inpaintedUri ?? pageLocalUri ?? uri;

  const showBadge = showOverlay && regions.length > 0 && renderPath !== "idle";

  // Per-page image readiness (independent of the CV overlay pipeline above).
  const imageNotReady = Platform.OS !== "web" && !cvState?.inpaintedUri && pageStatus !== "ready";
  const imageIsLoading = imageNotReady && (pageStatus === "checking" || pageStatus === "loading" || pageStatus === "retrying");
  const imageFailed    = imageNotReady && pageStatus === "error";

  // ── Diagnostic render logging ────────────────────────────────────────────
  if (__DEV__ && _renderCounts) {
    const key = uri.slice(-40);
    const count = (_renderCounts.get(key) ?? 0) + 1;
    _renderCounts.set(key, count);
    if (count <= 5 || count % 10 === 0) {
      console.log(
        `[MangaPage] render #${count}  page="${key}"` +
        `  pageStatus=${pageStatus}  imageNotReady=${imageNotReady}` +
        `  localUri=${pageLocalUri ? pageLocalUri.slice(-20) : "null"}`
      );
    }
    if (count > 20) {
      console.warn(`[MangaPage] EXCESSIVE RE-RENDERS (${count}) for page="${key}" — possible flicker loop!`);
    }
  }

  return (
    <View style={{ width: SCREEN_W, height: displayH, backgroundColor: "#000", overflow: "hidden" }}>
      {!imageNotReady && (
        <Image
          source={imageSource}
          style={{ width: SCREEN_W, height: displayH }}
          contentFit="fill"
          transition={100}
          recyclingKey={recyclingKey}
          onLoad={handleLoad}
          onError={reportRenderError}
        />
      )}

      {/* ── Per-page loading placeholder ─────────────────────────────────── */}
      {imageIsLoading && (
        <View style={styles.pageLoadingContainer} pointerEvents="none">
          {pageNumber != null && (
            <Text style={styles.pageLabel}>Page {pageNumber}</Text>
          )}
          {pageStatus === "retrying" ? (
            <>
              <ActivityIndicator size="small" color="#7B96FF" style={{ marginBottom: 8 }} />
              <Text style={styles.retryingText}>
                Retrying… (Attempt {retryAttempt}/{retryMax + 1})
              </Text>
            </>
          ) : pageProgress != null ? (
            <>
              <Text style={styles.progressText}>{Math.round(pageProgress * 100)}%</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(pageProgress * 100)}%` }]} />
              </View>
            </>
          ) : (
            <ActivityIndicator size="small" color="#7B96FF" />
          )}
        </View>
      )}

      {/* ── Per-page retry (shown only after all auto-retries are exhausted) ─ */}
      {imageFailed && (
        <View style={styles.pageLoadingContainer}>
          {pageNumber != null && (
            <Text style={styles.pageLabel}>Page {pageNumber}</Text>
          )}
          <Pressable onPress={retryPageImage} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>⟳ Retry</Text>
          </Pressable>
        </View>
      )}

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

      {/* ── Loading spinner ─────────────────────────────────────────────── */}
      {showOverlay && cvLoading && (
        <View
          style={styles.spinnerContainer}
          pointerEvents="none"
        >
          <ActivityIndicator size="small" color="#7B96FF" />
        </View>
      )}

      {/* ── CV PIPELINE / FALLBACK badge ────────────────────────────────── */}
      {showBadge && !cvLoading && (
        <View
          style={[
            styles.badge,
            renderPath === "cv" ? styles.badgeCV : styles.badgeFallback,
          ]}
          pointerEvents="none"
        >
          <Text style={styles.badgeDot}>
            {renderPath === "cv" ? "●" : "●"}
          </Text>
          <View style={styles.badgeTextBlock}>
            <Text style={styles.badgeLabel}>
              {renderPath === "cv" ? "CV PIPELINE" : "FALLBACK"}
            </Text>
            {renderPath === "cv" && cvState && cvState.inpaintedBytes > 0 && (
              <Text style={styles.badgeSub}>
                {`${Math.round(cvState.inpaintedBytes / 1024)} KB inpainted`}
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  spinnerContainer: {
    position: "absolute",
    top: 6,
    right: 8,
    opacity: 0.6,
  },
  pageLoadingContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pageLabel: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  progressText: {
    fontSize: 22,
    fontWeight: "700" as const,
    color: "#7B96FF",
  },
  progressTrack: {
    width: 80,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: "#7B96FF",
  },
  retryingText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600" as const,
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 5,
    opacity: 0.92,
  },
  badgeCV: {
    backgroundColor: "#0d2b1a",
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  badgeFallback: {
    backgroundColor: "#2b1000",
    borderWidth: 1,
    borderColor: "#f97316",
  },
  badgeDot: {
    fontSize: 7,
    color: "#ffffff",
  },
  badgeTextBlock: {
    flexDirection: "column",
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  badgeSub: {
    fontSize: 8,
    color: "#aaaaaa",
    marginTop: 1,
  },
});

export default memo(MangaPage);
