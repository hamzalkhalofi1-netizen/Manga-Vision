/**
 * DynamicFontScaler
 *
 * Conservative cascade font scaler.
 * Tries sizes from largest to smallest until text fits within the OCR bbox
 * safe zone (80% of bubble dims).
 *
 * Ladder: 18 → 16 → 14 → 12
 * Hard floor: 12 px (accepted even if still overflowing)
 */

import { splitArabicText, estimateTextHeight, getSafeZone } from "./ArabicTypesettingEngine";

const FONT_SIZE_LADDER = [18, 16, 14, 12] as const;
const LINE_HEIGHT_RATIO = 1.45;

export interface ScaledTypeset {
  fontSize:   number;
  lines:      string[];
  lineHeight: number;
}

function estimateLineWidth(line: string, fontSize: number): number {
  return line.length * fontSize * 0.62;
}

/**
 * scaleFontToFit — fits Arabic dialogue / narration text into the bbox safe zone.
 */
export function scaleFontToFit(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);

  for (const fontSize of FONT_SIZE_LADDER) {
    const lines   = splitArabicText(text, safeW, fontSize);
    const blockW  = Math.max(...lines.map((l) => estimateLineWidth(l, fontSize)));
    const blockH  = estimateTextHeight(lines.length, fontSize, LINE_HEIGHT_RATIO);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * LINE_HEIGHT_RATIO };
    }
  }

  // Hard floor
  const fallback = splitArabicText(text, safeW, 12);
  return { fontSize: 12, lines: fallback, lineHeight: 12 * LINE_HEIGHT_RATIO };
}

/**
 * scaleSFXFont — for short sound-effect / emphasis bursts.
 */
export function scaleSFXFont(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);
  const sfxLadder = [20, 18, 16, 14] as const;

  for (const fontSize of sfxLadder) {
    const lines  = splitArabicText(text, safeW, fontSize);
    const blockW = Math.max(...lines.map((l) => estimateLineWidth(l, fontSize)));
    const blockH = estimateTextHeight(lines.length, fontSize, 1.2);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * 1.2 };
    }
  }

  const fallback = splitArabicText(text, safeW, 14);
  return { fontSize: 14, lines: fallback, lineHeight: 14 * 1.2 };
}
