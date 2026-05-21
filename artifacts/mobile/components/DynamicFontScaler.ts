/**
 * DynamicFontScaler
 *
 * Recursively tries font sizes from largest to smallest until the text block
 * fits within the provided safe zone dimensions.
 *
 * Scale ladder: 22 → 18 → 16 → 14 → 12
 *
 * Algorithm per size:
 *  1. Split text into balanced lines at current font size.
 *  2. Estimate rendered block width (longest line × avg glyph width).
 *  3. Estimate rendered block height (line count × lineHeight).
 *  4. Accept if both fit within safeW × safeH.
 *  5. Otherwise shrink to next step and repeat.
 *  6. If 12px still doesn't fit, accept it anyway (minimum readable size).
 */

import { splitArabicText, estimateTextHeight, getSafeZone } from "./ArabicTypesettingEngine";

const FONT_SIZE_LADDER = [22, 20, 18, 16, 14, 12] as const;
const LINE_HEIGHT_MULTIPLIER = 1.45;

export interface ScaledTypeset {
  fontSize: number;
  lines: string[];
  lineHeight: number;
}

/**
 * Estimate the rendered width of the longest line.
 * Average Arabic glyph width ≈ fontSize × 0.60.
 */
function estimateBlockWidth(lines: string[], fontSize: number): number {
  const longestLen = Math.max(...lines.map((l) => l.length), 1);
  return longestLen * fontSize * 0.60;
}

/**
 * Compute the optimal font size and balanced line splits so the text block
 * fits within the safe zone of the given bubble dimensions.
 *
 * @param text       - Arabic translated text string
 * @param bubbleW    - rendered bubble pixel width
 * @param bubbleH    - rendered bubble pixel height
 */
export function scaleFontToFit(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);

  for (const fontSize of FONT_SIZE_LADDER) {
    const lines = splitArabicText(text, safeW, fontSize);
    const blockW = estimateBlockWidth(lines, fontSize);
    const blockH = estimateTextHeight(lines.length, fontSize, LINE_HEIGHT_MULTIPLIER);

    const fitsWidth = blockW <= safeW;
    const fitsHeight = blockH <= safeH;

    if (fitsWidth && fitsHeight) {
      return {
        fontSize,
        lines,
        lineHeight: fontSize * LINE_HEIGHT_MULTIPLIER,
      };
    }
  }

  // Minimum fallback — accept 12px even if it technically overflows
  const minFontSize = 12;
  const fallbackLines = splitArabicText(text, safeW, minFontSize);
  return {
    fontSize: minFontSize,
    lines: fallbackLines,
    lineHeight: minFontSize * LINE_HEIGHT_MULTIPLIER,
  };
}

/**
 * For SFX / emphasis regions use a slightly larger scale ladder since those
 * regions are usually short single-word bursts.
 */
export function scaleSFXFont(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);
  const sfxLadder = [26, 22, 18, 16, 14] as const;

  for (const fontSize of sfxLadder) {
    const lines = splitArabicText(text, safeW, fontSize);
    const blockW = estimateBlockWidth(lines, fontSize);
    const blockH = estimateTextHeight(lines.length, fontSize, 1.2);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * 1.2 };
    }
  }

  const fallbackLines = splitArabicText(text, safeW, 14);
  return { fontSize: 14, lines: fallbackLines, lineHeight: 14 * 1.2 };
}
