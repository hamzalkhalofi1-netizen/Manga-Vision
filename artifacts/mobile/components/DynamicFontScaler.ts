/**
 * DynamicFontScaler
 *
 * Recursive cascade font scaler: tries sizes from largest to smallest
 * until the text block fits within the safe zone (80% of bubble dims).
 *
 * Cascade: 20 → 18 → 16 → 14 → 12
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

const FONT_SIZE_LADDER = [20, 18, 16, 14, 12] as const;
const LINE_HEIGHT_MULTIPLIER = 1.45;

export interface ScaledTypeset {
  fontSize: number;
  lines: string[];
  lineHeight: number;
}

/**
 * Estimate the rendered width of the longest line.
 * Average Arabic glyph width ≈ fontSize × 0.62.
 */
function estimateBlockWidth(lines: string[], fontSize: number): number {
  const longestLen = Math.max(...lines.map((l) => l.length), 1);
  return longestLen * fontSize * 0.62;
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
    const blockW = estimateBlockWidth(lines, fontSize);
    const blockH = estimateTextHeight(lines.length, fontSize, LINE_HEIGHT_MULTIPLIER);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * LINE_HEIGHT_MULTIPLIER };
    }
  }

  // Hard floor — 12 px accepted even if technically overflowing
  const fallbackLines = splitArabicText(text, safeW, 12);
  return { fontSize: 12, lines: fallbackLines, lineHeight: 12 * LINE_HEIGHT_MULTIPLIER };
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
  const sfxLadder = [24, 20, 18, 16, 14] as const;

  for (const fontSize of sfxLadder) {
    const lines  = splitArabicText(text, safeW, fontSize);
    const blockW = estimateBlockWidth(lines, fontSize);
    const blockH = estimateTextHeight(lines.length, fontSize, 1.2);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * 1.2 };
    }
  }

  const fallbackLines = splitArabicText(text, safeW, 14);
  return { fontSize: 14, lines: fallbackLines, lineHeight: 14 * 1.2 };
}
