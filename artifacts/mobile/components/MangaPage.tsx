import { Image } from "expo-image";
import React, { memo, useCallback, useState } from "react";
import { Dimensions, View } from "react-native";
import PremiumOverlayRenderer from "./PremiumOverlayRenderer";

const SCREEN_W = Dimensions.get("window").width;
const DEFAULT_ASPECT = 1.45;

/**
 * A 4-point polygon in normalized [0,1] image coordinates.
 * Order: top-left, top-right, bottom-right, bottom-left (clockwise).
 * Used for precise bubble-shape mask rendering via react-native-svg.
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
  /** Normalized bounding box (0–1) of the bubble body */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Normalized center of the bounding box */
  centerX?: number;
  centerY?: number;
  /**
   * 4-point clockwise polygon describing the actual bubble boundary.
   * Falls back to a rectangle derived from x/y/w/h if absent.
   */
  polygon?: BubblePolygon;
  /** "speech" | "thought" | "sfx" | "sign" | "narration" | "title" */
  type: string;
  /** Hex color of the bubble interior background */
  bgColor: string;
  /** Hex color of the original text (used to derive translation text color) */
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
}: MangaPageProps) {
  const [displayH, setDisplayH] = useState(Math.round(SCREEN_W * DEFAULT_ASPECT));
  const [nativeDims, setNativeDims] = useState({ w: 0, h: 0 });

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

  return (
    <View style={{ width: SCREEN_W, height: displayH, backgroundColor: "#000" }}>
      <Image
        source={{ uri }}
        style={{ width: SCREEN_W, height: displayH }}
        contentFit="fill"
        transition={100}
        recyclingKey={uri}
        onLoad={handleLoad}
      />

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
