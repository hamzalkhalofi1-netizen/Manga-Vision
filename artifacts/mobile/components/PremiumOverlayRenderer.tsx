/**
 * PremiumOverlayRenderer
 *
 * Orchestrates the Google Translate–style text erase + snap pipeline:
 *
 *   Original Manga Image  (rendered by MangaPage — never touched)
 *           +
 *   SmartInpaintingEngine  (samples pixels OUTSIDE each OCR bbox)
 *           +
 *   SkiaOverlayCanvas      (transparent layer — Arabic text only)
 *
 * Guarantees:
 *  ✅ Zero white rectangles  ✅ Zero synthetic shapes
 *  ✅ Overlay root 100% transparent  ✅ pointerEvents: 'none'
 *  ✅ Inpaint fill ≤ 1-px inset  ✅ Text snapped dead-center on OCR bbox
 *  ✅ Token / auth / chapter binding NEVER touched
 *
 * Sampling fallback:
 *  When nativeW / nativeH are not yet available (image still loading),
 *  we use displayW / displayH as the canvas scale reference.  The
 *  normalised OCR coordinates (0–1) remain correct regardless.
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import { sampleInpaintColors, type InpaintColor } from "./SmartInpaintingEngine";
import SkiaOverlayCanvas from "./SkiaOverlayCanvas";

interface PremiumOverlayRendererProps {
  uri: string;
  regions: TextRegion[];
  displayW: number;
  displayH: number;
  nativeW: number;
  nativeH: number;
  isRTL?: boolean;
}

function PremiumOverlayRenderer({
  uri,
  regions,
  displayW,
  displayH,
  nativeW,
  nativeH,
  isRTL = true,
}: PremiumOverlayRendererProps) {
  const [inpaintColors, setInpaintColors] = useState<Record<number, InpaintColor>>({});
  const samplingRef = useRef(false);
  const uriRef      = useRef(uri);

  // ── Reset state whenever the page URI changes ──────────────────────────────
  useEffect(() => {
    if (uriRef.current !== uri) {
      uriRef.current    = uri;
      samplingRef.current = false;
      setInpaintColors({});
    }
  }, [uri]);

  // ── Trigger pixel sampling once per page ──────────────────────────────────
  // Falls back to displayW/displayH when native image dimensions are not yet
  // known — the normalised OCR coordinates work at any scale.
  useEffect(() => {
    if (regions.length === 0 || samplingRef.current) return;

    // Use nativeW/H when available; fall back to display dims so sampling
    // is never silently skipped while the image is still loading.
    const refW = nativeW > 0 ? nativeW : displayW;
    const refH = nativeH > 0 ? nativeH : displayH;

    if (refW === 0 || refH === 0) return;

    samplingRef.current = true;

    sampleInpaintColors(uri, regions, refW, refH).then((colors) => {
      setInpaintColors(colors);
    });
  }, [uri, regions, nativeW, nativeH, displayW, displayH]);

  if (regions.length === 0) return null;

  return (
    <View
      style={[
        styles.overlayRoot,
        { width: displayW, height: displayH, pointerEvents: "none" },
      ]}
    >
      <SkiaOverlayCanvas
        regions={regions}
        displayW={displayW}
        displayH={displayH}
        inpaintColors={inpaintColors}
        isRTL={isRTL}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: "transparent",
  },
});

export default memo(PremiumOverlayRenderer);
