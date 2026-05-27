/**
 * PremiumOverlayRenderer
 *
 * Pure text overlay — no fill shapes, no inpaint colors, no rectangles.
 *
 * The text-erase step now happens entirely on the server (POST /api/inpaint
 * in MangaPage). By the time this component renders, the underlying image
 * already has its original text pixel-erased. This layer only places the
 * translated Arabic (or other language) text, centered on each OCR bbox.
 *
 * Guarantees:
 *  ✅ Zero fill rectangles  ✅ Zero white shapes  ✅ Zero synthetic geometry
 *  ✅ Overlay root 100% transparent  ✅ pointerEvents: 'none'
 *  ✅ Text snapped dead-center on OCR bbox using centerX / centerY
 */

import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import type { TextRegion } from "./MangaPage";
import SkiaOverlayCanvas from "./SkiaOverlayCanvas";

interface PremiumOverlayRendererProps {
  regions: TextRegion[];
  displayW: number;
  displayH: number;
  nativeW: number;
  nativeH: number;
  isRTL?: boolean;
}

function PremiumOverlayRenderer({
  regions,
  displayW,
  displayH,
  isRTL = true,
}: PremiumOverlayRendererProps) {
  if (regions.length === 0) return null;

  return (
    <View
      style={[
        styles.overlayRoot,
        { width: displayW, height: displayH },
      ]}
    >
      <SkiaOverlayCanvas
        regions={regions}
        displayW={displayW}
        displayH={displayH}
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
