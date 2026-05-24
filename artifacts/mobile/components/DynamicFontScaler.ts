/**
 * DynamicFontScaler
 *
 * Cascade font scaler: tries sizes from largest to smallest until the text
 * block fits within the safe zone (80% of bubble dims).
 *
 * Cascade: 22 → 20 → 18 → 16 → 14 → 12
 *
 * Per step:
 *  1. Split text into balanced, overflow-validated lines.
 *  2. Estimate rendered block width  (longest line × avg glyph width).
 *  3. Estimate rendered block height (line count × lineHeight).
 *  4. Accept if both fit inside safeW × safeH.
 *  5. Otherwise shrink one step and repeat.
 *  6. 12 px is the hard floor — accepted even if it still overflows.
 */

import { splitArabicText, estimateTextHeight, getSafeZone } from "./ArabicTypesettingEngine";

export const FONT_SIZE_LADDER = [22, 20, 18, 16, 14, 12] as const;
export const MIN_FONT_SIZE = 12;
export const LINE_HEIGHT_MULTIPLIER = 1.45;

/**
 * Estimate the rendered pixel width of the longest line.
 * Average Arabic glyph width ≈ fontSize × 0.65 (slightly generous to avoid
 * mask under-sizing on wide characters / ligatures).
 */
export function estimateBlockWidth(lines: string[], fontSize: number): number {
  const longestLen = Math.max(...lines.map((l) => l.length), 1);
  return longestLen * fontSize * 0.65;
}

export interface ScaledTypeset {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  /** Estimated rendered width of the widest text line (pixels). */
  textW: number;
  /** Estimated rendered height of the full text block (pixels). */
  textH: number;
}

/**
 * scaleFontToFit — main export.
 * Fits Arabic dialogue / narration text into the bubble safe zone.
 */
export function scaleFontToFit(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);

  for (const fontSize of FONT_SIZE_LADDER) {
    const lines  = splitArabicText(text, safeW, fontSize);
    const textW  = estimateBlockWidth(lines, fontSize);
    const textH  = estimateTextHeight(lines.length, fontSize, LINE_HEIGHT_MULTIPLIER);

    if (textW <= safeW && textH <= safeH) {
      return {
        fontSize,
        lines,
        lineHeight: fontSize * LINE_HEIGHT_MULTIPLIER,
        textW,
        textH,
      };
    }
  }

  // Hard floor — 12 px accepted even if technically overflowing
  const fallbackLines = splitArabicText(text, safeW, MIN_FONT_SIZE);
  const fallbackW = estimateBlockWidth(fallbackLines, MIN_FONT_SIZE);
  const fallbackH = estimateTextHeight(fallbackLines.length, MIN_FONT_SIZE, LINE_HEIGHT_MULTIPLIER);
  return {
    fontSize:   MIN_FONT_SIZE,
    lines:      fallbackLines,
    lineHeight: MIN_FONT_SIZE * LINE_HEIGHT_MULTIPLIER,
    textW:      fallbackW,
    textH:      fallbackH,
  };
}

/**
 * scaleSFXFont — for short sound-effect / emphasis bursts.
 * Starts larger since SFX labels are usually 1–3 characters.
 */
export function scaleSFXFont(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);
  const sfxLadder = [26, 22, 20, 18, 16, 14] as const;

  for (const fontSize of sfxLadder) {
    const lines  = splitArabicText(text, safeW, fontSize);
    const textW  = estimateBlockWidth(lines, fontSize);
    const textH  = estimateTextHeight(lines.length, fontSize, 1.2);

    if (textW <= safeW && textH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * 1.2, textW, textH };
    }
  }

  const fallbackLines = splitArabicText(text, safeW, 14);
  const fallbackW = estimateBlockWidth(fallbackLines, 14);
  const fallbackH = estimateTextHeight(fallbackLines.length, 14, 1.2);
  return { fontSize: 14, lines: fallbackLines, lineHeight: 14 * 1.2, textW: fallbackW, textH: fallbackH };
}
