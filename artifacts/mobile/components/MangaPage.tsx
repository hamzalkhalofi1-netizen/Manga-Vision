import { Image } from "expo-image";
import React, { memo, useCallback, useState } from "react";
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
} from "react-native";

const SCREEN_W = Dimensions.get("window").width;
const DEFAULT_ASPECT = 1.45; // manga default aspect ratio (taller than wide)

export interface TextRegion {
  original: string;
  translated: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
}

function MangaPage({ uri, regions = [], showOverlay, isRTL = false, onHeightKnown }: MangaPageProps) {
  const [displayH, setDisplayH] = useState<number>(Math.round(SCREEN_W * DEFAULT_ASPECT));

  const handleLoad = useCallback(
    (e: { source: { width: number; height: number } }) => {
      const { width, height } = e.source;
      if (width > 0 && height > 0) {
        const h = Math.round(SCREEN_W * (height / width));
        setDisplayH(h);
        onHeightKnown?.(h);
      }
    },
    [onHeightKnown]
  );

  return (
    <View style={{ width: SCREEN_W, height: displayH }}>
      {/* Full-width manga page — no bars, no padding */}
      <Image
        source={{ uri }}
        style={{ width: SCREEN_W, height: displayH }}
        contentFit="fill"
        transition={100}
        recyclingKey={uri}
        onLoad={handleLoad}
      />

      {/* Inpainting + Translation overlay */}
      {showOverlay &&
        regions.map((region, idx) => {
          const left = region.x * SCREEN_W;
          const top = region.y * displayH;
          const width = region.w * SCREEN_W;
          const height = region.h * displayH;

          if (width < 10 || height < 8) return null;

          const bg = hexToRgba(region.bgColor || "#ffffff", 0.96);
          const textColor = region.textColor || "#000000";
          const isSFX = region.type === "sfx";
          const isThought = region.type === "thought";

          // Dynamic font size based on available area and text length
          const textLen = region.translated.length;
          const area = width * height;
          const rawSize = Math.sqrt(area / Math.max(textLen, 1)) * 0.55;
          const fontSize = Math.min(isSFX ? 18 : 15, Math.max(7, rawSize));
          const lineHeight = fontSize * (isSFX ? 1.0 : 1.35);
          const borderRadius = isThought ? height * 0.4 : Math.min(10, height * 0.18);
          const padding = Math.max(3, Math.min(8, height * 0.1));

          return (
            <View
              key={idx}
              style={[
                styles.overlay,
                {
                  left,
                  top,
                  width,
                  height,
                  backgroundColor: bg,
                  borderRadius,
                  padding,
                  borderColor: isSFX ? "rgba(255,200,0,0.6)" : "rgba(0,0,0,0.08)",
                  borderWidth: isSFX ? 1.5 : 0.5,
                },
              ]}
            >
              <Text
                style={[
                  styles.overlayText,
                  {
                    color: textColor,
                    fontSize,
                    lineHeight,
                    fontWeight: (isSFX || region.emphasis) ? "800" : "600",
                    textAlign: isRTL ? "right" : "center",
                    writingDirection: isRTL ? "rtl" : "ltr",
                    fontStyle: isThought ? "italic" : "normal",
                    letterSpacing: isSFX ? 0.5 : 0,
                  },
                ]}
                adjustsFontSizeToFit
                minimumFontScale={0.45}
                numberOfLines={0}
              >
                {region.translated}
              </Text>
            </View>
          );
        })}
    </View>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  try {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255,255,255,${alpha})`;
    return `rgba(${r},${g},${b},${alpha})`;
  } catch {
    return `rgba(255,255,255,${alpha})`;
  }
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 3,
  },
  overlayText: {
    flexShrink: 1,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});

export default memo(MangaPage);
