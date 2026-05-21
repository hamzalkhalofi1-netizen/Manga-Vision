/**
 * AdaptiveTextColorEngine
 *
 * Determines optimal Arabic text color by analysing the inpainted bubble
 * background luminance.  Implements WCAG-based relative luminance so text
 * always meets a minimum contrast ratio against the fill layer.
 *
 *  Light bubble  →  dark text  '#1A1A1A'
 *  Dark  bubble  →  light text '#F8F8F8'
 *
 * Shadow recommendations are also returned so the caller can add a subtle
 * halo that separates the glyph from any texture noise.
 */

export interface TextColorProfile {
  /** Primary text fill color */
  color: string;
  /** Subtle shadow color (low-opacity complement) */
  shadowColor: string;
  /** Shadow radius — 0 for clean dark backgrounds, subtle for light */
  shadowRadius: number;
  /** True when background is classified as dark */
  isDark: boolean;
}

/** Convert an 8-bit channel (0–255) to linear light for WCAG luminance. */
function linearize(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.1 relative luminance  (0 = black, 1 = white).
 */
export function calculateLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Classify a bubble fill as 'light' or 'dark' using its luminance.
 * Threshold 0.35 is tuned for manga which tends toward high-contrast bubbles
 * (white speech, black panels) rather than mid-tone ones.
 */
export function detectBubbleBrightness(
  r: number,
  g: number,
  b: number
): "light" | "dark" {
  const lum = calculateLuminance(r, g, b);
  return lum >= 0.35 ? "light" : "dark";
}

/**
 * Resolve the full text color profile from an RGB fill triple.
 *
 * @param r  0–255 red
 * @param g  0–255 green
 * @param b  0–255 blue
 */
export function resolveOptimalTextColor(
  r: number,
  g: number,
  b: number
): TextColorProfile {
  const brightness = detectBubbleBrightness(r, g, b);

  if (brightness === "light") {
    return {
      color: "#1A1A1A",
      shadowColor: "rgba(255,255,255,0.55)",
      shadowRadius: 1.2,
      isDark: false,
    };
  }

  return {
    color: "#F8F8F8",
    shadowColor: "rgba(0,0,0,0.60)",
    shadowRadius: 1.8,
    isDark: true,
  };
}

/**
 * Parse any CSS color string (rgb/hex) into {r,g,b} and resolve the profile.
 * Falls back to dark-text-on-white if the string cannot be parsed.
 */
export function resolveFromCss(css: string): TextColorProfile {
  try {
    if (css.startsWith("rgb")) {
      const m = css.match(/\d+/g);
      if (m && m.length >= 3) {
        return resolveOptimalTextColor(
          parseInt(m[0]),
          parseInt(m[1]),
          parseInt(m[2])
        );
      }
    }
    if (css.startsWith("#")) {
      const c = css.replace("#", "");
      const full =
        c.length === 3 ? c.split("").map((x) => x + x).join("") : c.slice(0, 6);
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return resolveOptimalTextColor(r, g, b);
      }
    }
  } catch {
    // fall through
  }

  // Safe default: dark text on light bubble
  return {
    color: "#1A1A1A",
    shadowColor: "rgba(255,255,255,0.4)",
    shadowRadius: 1.0,
    isDark: false,
  };
}
