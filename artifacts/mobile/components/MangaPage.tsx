import { Image } from "expo-image";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Platform, StyleSheet, Text, View } from "react-native";

const SCREEN_W = Dimensions.get("window").width;
const DEFAULT_ASPECT = 1.45;

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

// ─── Web canvas color sampler ───────────────────────────────────────────────
// Samples actual pixel colors from corners of each text region.
// Falls back to Gemini's bgColor when canvas is unavailable (native/CORS fail).
async function sampleBubbleColors(
  imageUri: string,
  regions: TextRegion[],
  imgNativeW: number,
  imgNativeH: number
): Promise<Record<number, string>> {
  if (Platform.OS !== "web" || typeof document === "undefined" || regions.length === 0) {
    return {};
  }

  return new Promise((resolve) => {
    const img = new (window as Window & typeof globalThis).Image();
    img.crossOrigin = "anonymous";

    const finish = (canvas?: HTMLCanvasElement, ctx?: CanvasRenderingContext2D) => {
      const colors: Record<number, string> = {};
      if (!canvas || !ctx) {
        resolve(colors);
        return;
      }

      const W = imgNativeW || canvas.width;
      const H = imgNativeH || canvas.height;

      regions.forEach((region, idx) => {
        try {
          const rx = Math.round(region.x * W);
          const ry = Math.round(region.y * H);
          const rw = Math.round(region.w * W);
          const rh = Math.round(region.h * H);

          // Sample 6 corner/edge points (avoiding the text-center area)
          const pts = [
            [rx + 2, ry + 2],
            [rx + rw - 2, ry + 2],
            [rx + 2, ry + rh - 2],
            [rx + rw - 2, ry + rh - 2],
            [rx + Math.round(rw / 2), ry + 2],
            [rx + 2, ry + Math.round(rh / 2)],
          ];

          let r = 0, g = 0, b = 0, count = 0;
          for (const [px, py] of pts) {
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            const d = ctx.getImageData(px, py, 1, 1).data;
            // Skip near-transparent or uniform black (possible CORS fill)
            if (d[3] < 10) continue;
            r += d[0];
            g += d[1];
            b += d[2];
            count++;
          }

          if (count >= 2) {
            const ar = Math.round(r / count);
            const ag = Math.round(g / count);
            const ab = Math.round(b / count);

            // Only use sampled color if it's not uniform black (CORS fallback color)
            if (ar > 5 || ag > 5 || ab > 5) {
              colors[idx] = `rgb(${ar},${ag},${ab})`;
            }
          }
        } catch {
          // Skip this region
        }
      });

      resolve(colors);
    };

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        // Use natural or estimated dimensions
        canvas.width = img.naturalWidth || imgNativeW;
        canvas.height = img.naturalHeight || imgNativeH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({});
          return;
        }
        ctx.drawImage(img, 0, 0);
        finish(canvas, ctx);
      } catch {
        resolve({});
      }
    };

    img.onerror = () => resolve({});

    // 6s timeout — don't block rendering
    const timeout = setTimeout(() => resolve({}), 6000);
    img.onload = function () {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || imgNativeW;
        canvas.height = img.naturalHeight || imgNativeH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({});
          return;
        }
        ctx.drawImage(img, 0, 0);
        finish(canvas, ctx);
      } catch {
        resolve({});
      }
    };

    img.src = imageUri;
  });
}

// ─── MangaPage component ─────────────────────────────────────────────────────
function MangaPage({
  uri,
  regions = [],
  showOverlay,
  isRTL = false,
  onHeightKnown,
}: MangaPageProps) {
  const [displayH, setDisplayH] = useState(Math.round(SCREEN_W * DEFAULT_ASPECT));
  const [nativeDims, setNativeDims] = useState({ w: 0, h: 0 });

  // Sampled pixel colors — overrides Gemini's bgColor when available
  const [sampledColors, setSampledColors] = useState<Record<number, string>>({});
  const samplingDone = useRef(false);

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

  // Canvas sampling after image dimensions are known and overlay is requested
  useEffect(() => {
    if (
      !showOverlay ||
      regions.length === 0 ||
      nativeDims.w === 0 ||
      samplingDone.current
    ) {
      return;
    }
    samplingDone.current = true;

    sampleBubbleColors(uri, regions, nativeDims.w, nativeDims.h).then(
      (colors) => {
        if (Object.keys(colors).length > 0) {
          setSampledColors(colors);
        }
      }
    );
  }, [uri, regions, showOverlay, nativeDims]);

  // Reset sampling when URI changes
  useEffect(() => {
    samplingDone.current = false;
    setSampledColors({});
  }, [uri]);

  return (
    <View style={{ width: SCREEN_W, height: displayH, backgroundColor: "#000" }}>
      {/* Full-width, edge-to-edge manga page */}
      <Image
        source={{ uri }}
        style={{ width: SCREEN_W, height: displayH }}
        contentFit="fill"
        transition={100}
        recyclingKey={uri}
        onLoad={handleLoad}
      />

      {/* Smart inpainting + translated text overlay */}
      {showOverlay &&
        regions.map((region, idx) => {
          const left = region.x * SCREEN_W;
          const top = region.y * displayH;
          const width = region.w * SCREEN_W;
          const height = region.h * displayH;

          // Skip tiny/invalid regions
          if (width < 12 || height < 10) return null;

          const isSFX = region.type === "sfx";
          const isThought = region.type === "thought";
          const isNarration = region.type === "narration";

          // Smart background: prefer pixel-sampled color, then Gemini's color
          const rawBg = sampledColors[idx] ?? region.bgColor ?? "#ffffff";
          const fillColor = resolveColor(rawBg, isSFX);
          const textColor = region.textColor || contrastColor(rawBg);

          // Ultra-tight padding — 2-3px absolute, not percentage
          const padH = Math.max(2, Math.min(4, height * 0.06));
          const padV = Math.max(2, Math.min(4, width * 0.04));

          // Adaptive font sizing
          const textLen = Math.max(region.translated.length, 1);
          const usableArea = (width - padV * 2) * (height - padH * 2);
          const rawSize = Math.sqrt(usableArea / textLen) * 0.62;
          const fontSize = Math.min(isSFX ? 17 : 14, Math.max(7, rawSize));
          const lineH = fontSize * (isSFX ? 1.05 : 1.3);

          // Bubble shape
          const borderRadius = isThought
            ? Math.min(height / 2, width / 2)
            : isNarration
            ? 3
            : Math.min(8, height * 0.15);

          return (
            <View
              key={idx}
              style={[
                styles.bubble,
                {
                  left,
                  top,
                  width,
                  height,
                  backgroundColor: fillColor,
                  borderRadius,
                  paddingHorizontal: padV,
                  paddingVertical: padH,
                  // SFX get a visible border; narration gets a faint one
                  borderColor: isSFX
                    ? "rgba(255, 190, 0, 0.7)"
                    : isNarration
                    ? "rgba(0,0,0,0.2)"
                    : "transparent",
                  borderWidth: isSFX ? 1.5 : isNarration ? 1 : 0,
                },
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  {
                    color: textColor,
                    fontSize,
                    lineHeight: lineH,
                    fontWeight: isSFX || region.emphasis ? "900" : "700",
                    textAlign: isRTL ? "right" : "center",
                    writingDirection: isRTL ? "rtl" : "ltr",
                    fontStyle: isThought ? "italic" : "normal",
                    letterSpacing: isSFX ? 0.8 : 0,
                    fontFamily: isRTL ? undefined : undefined,
                  },
                ]}
                adjustsFontSizeToFit
                minimumFontScale={0.4}
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

/** Pick an opaque fill color. SFX gets a warm tint if white. */
function resolveColor(raw: string, isSFX: boolean): string {
  const hex = raw.startsWith("#") ? raw : rgbToHex(raw);
  if (isSFX && (hex === "#ffffff" || hex === "#FFFFFF")) {
    return "rgba(255, 248, 210, 1)";
  }
  // Return full-opacity version of the color
  if (raw.startsWith("rgb(")) {
    return raw.replace("rgb(", "rgba(").replace(")", ", 1)");
  }
  return hexToOpaque(hex);
}

function hexToOpaque(hex: string): string {
  try {
    const c = hex.replace("#", "");
    if (c.length < 6) return "#ffffff";
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return "#ffffff";
    return `rgb(${r},${g},${b})`;
  } catch {
    return "#ffffff";
  }
}

function rgbToHex(rgb: string): string {
  try {
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return "#ffffff";
    return (
      "#" +
      [m[0], m[1], m[2]]
        .map((v) => parseInt(v).toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    return "#ffffff";
  }
}

/** Return black or white depending on which contrasts better with `bg`. */
function contrastColor(bg: string): string {
  try {
    let r = 255, g = 255, b = 255;
    if (bg.startsWith("#")) {
      const c = bg.replace("#", "");
      r = parseInt(c.slice(0, 2), 16);
      g = parseInt(c.slice(2, 4), 16);
      b = parseInt(c.slice(4, 6), 16);
    } else if (bg.startsWith("rgb")) {
      const m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        r = parseInt(m[0]);
        g = parseInt(m[1]);
        b = parseInt(m[2]);
      }
    }
    // Relative luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 140 ? "#000000" : "#ffffff";
  } catch {
    return "#000000";
  }
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  bubbleText: {
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});

export default memo(MangaPage);
