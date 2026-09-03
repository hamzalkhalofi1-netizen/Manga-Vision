/**
 * PremiumOverlayRenderer
 *
 * Transparent wrapper around SkiaOverlayCanvas.
 * Guarantees zero pointer-event capture and a fully transparent root.
 *
 * Passes imageUri to SkiaOverlayCanvas so it can perform per-region
 * pixel sampling via BubbleColorSampler (web only, async, with CORS fallback).
 */

import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import SkiaOverlayCanvas from "./SkiaOverlayCanvas";

interface PremiumOverlayRendererProps {
  regions:   TextRegion[];
  displayW:  number;
  displayH:  number;
  nativeW:   number;
  nativeH:   number;
  isRTL?:    boolean;
  /** Full URL of the manga page image — forwarded to pixel color sampler. */
  imageUri?: string;
}

function PremiumOverlayRenderer({
  regions,
  displayW,
  displayH,
  isRTL = true,
  imageUri,
}: PremiumOverlayRendererProps) {
  if (regions.length === 0) return null;

  return (
    <View
      style={[
        styles.overlayRoot,
        { width: displayW, height: displayH },
      ]}
      pointerEvents="none"
    >
      <SkiaOverlayCanvas
        regions={regions}
        displayW={displayW}
        displayH={displayH}
        isRTL={isRTL}
        imageUri={imageUri}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position:        "absolute",
    top: 0,
    left: 0,
    backgroundColor: "transparent",
  },
});

export default memo(PremiumOverlayRenderer);
