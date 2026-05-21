/**
 * PremiumOverlayRenderer
 *
 * Professional scanlation-quality translation overlay.
 *
 * Architecture:
 *
 *   Original Manga Image  (untouched — rendered by MangaPage)
 *           +
 *   SmartInpaintingEngine  (samples bubble background pixels)
 *           +
 *   SkiaOverlayCanvas      (transparent layer, Arabic text only)
 *
 * Rendering guarantees:
 *  ✅ Zero white rectangles
 *  ✅ Zero synthetic shapes / bubble outlines
 *  ✅ Zero border containers
 *  ✅ Overlay root is 100% transparent
 *  ✅ pointerEvents: 'none' — never blocks scroll
 *  ✅ Inpaint layer limited to 2 px inset (never bleeds outside contour)
 *  ✅ Arabic text centered, balanced, dynamically scaled
 *  ✅ Token / auth logic completely untouched
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
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
  const uriRef = useRef(uri);

  // Reset when URI (page) changes
  useEffect(() => {
    if (uriRef.current !== uri) {
      uriRef.current = uri;
      samplingRef.current = false;
      setInpaintColors({});
    }
  }, [uri]);

  // Run pixel sampling once per page when dimensions are known
  useEffect(() => {
    if (
      regions.length === 0 ||
      nativeW === 0 ||
      nativeH === 0 ||
      samplingRef.current
    ) {
      return;
    }

    samplingRef.current = true;

    sampleInpaintColors(uri, regions, nativeW, nativeH).then((colors) => {
      setInpaintColors(colors);
    });
  }, [uri, regions, nativeW, nativeH]);

  if (regions.length === 0) return null;

  return (
    <View
      style={[styles.overlayRoot, { width: displayW, height: displayH, pointerEvents: "none" }]}
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
