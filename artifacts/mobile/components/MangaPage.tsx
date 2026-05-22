import { Image } from "expo-image";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, View } from "react-native";
import PremiumOverlayRenderer from "./PremiumOverlayRenderer";

const SCREEN_W = Dimensions.get("window").width;
const DEFAULT_ASPECT = 1.45;

export interface TextRegion {
  original: string;
  translated: string;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX?: number;
  centerY?: number;
  type: string;
  bgColor: string;
  textColor: string;
  speaker: string | null;
  emphasis: boolean;
}

interface MangaPageProps {
  uri: string;
  regions?: TextRegion[];
  showOverlay: boolean;
  isRTL?: boolean;
  onHeightKnown?: (height: number) => void;
  apiBase?: string;
  userApiKey?: string | null;
}

function MangaPage({
  uri,
  regions = [],
  showOverlay,
  isRTL = false,
  onHeightKnown,
  apiBase,
  userApiKey,
}: MangaPageProps) {
  const [displayH, setDisplayH] = useState(Math.round(SCREEN_W * DEFAULT_ASPECT));
  const [nativeDims, setNativeDims] = useState({ w: 0, h: 0 });

  // ── Server-side inpainted image URI ─────────────────────────────────────────
  // When OCR regions are available, we ask the server to pixel-erase the
  // original text from the image buffer (border-pixel sampling, 1-px inset).
  // The inpainted image replaces the original so the overlay layer can be
  // 100% transparent — no fill rectangles of any kind.
  const [inpaintedUri, setInpaintedUri] = useState<string | null>(null);
  const inpaintCtrlRef = useRef<AbortController | null>(null);
  const lastInpaintKeyRef = useRef<string>("");

  useEffect(() => {
    // Reset inpainted image whenever the source URI changes
    setInpaintedUri(null);
    lastInpaintKeyRef.current = "";
  }, [uri]);

  useEffect(() => {
    if (!regions || regions.length === 0 || !apiBase) {
      return;
    }

    // Deduplicate: don't re-call if regions + uri haven't changed
    const key = `${uri}:${regions.length}`;
    if (key === lastInpaintKeyRef.current) return;
    lastInpaintKeyRef.current = key;

    // Cancel any in-flight inpaint call
    inpaintCtrlRef.current?.abort();
    const ctrl = new AbortController();
    inpaintCtrlRef.current = ctrl;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (userApiKey) headers["X-Gemini-Key"] = userApiKey;

    fetch(`${apiBase}/api/inpaint`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        imageUrl: uri,
        regions: regions.map((r) => ({
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          bgColor: r.bgColor,
        })),
      }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (data?.inpaintedImage && !ctrl.signal.aborted) {
          const mime = data.mimeType ?? "image/png";
          setInpaintedUri(`data:${mime};base64,${data.inpaintedImage}`);
        }
      })
      .catch(() => {
        // Inpainting failed — original image stays visible; overlay is text-only
      });

    return () => {
      ctrl.abort();
    };
  }, [uri, regions, apiBase, userApiKey]);

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

  // Use the inpainted image when ready, fall back to the original
  const displayUri = inpaintedUri ?? uri;

  return (
    <View style={{ width: SCREEN_W, height: displayH, backgroundColor: "#000" }}>
      {/* Manga page — swaps to server-inpainted version once ready */}
      <Image
        source={{ uri: displayUri }}
        style={{ width: SCREEN_W, height: displayH }}
        contentFit="fill"
        transition={inpaintedUri ? 200 : 100}
        recyclingKey={displayUri}
        onLoad={handleLoad}
      />

      {/* Text-only transparent overlay — zero fill rectangles */}
      {showOverlay && regions.length > 0 && (
        <PremiumOverlayRenderer
          regions={regions}
          displayW={SCREEN_W}
          displayH={displayH}
          nativeW={nativeDims.w}
          nativeH={nativeDims.h}
          isRTL={isRTL}
        />
      )}
    </View>
  );
}

export default memo(MangaPage);
