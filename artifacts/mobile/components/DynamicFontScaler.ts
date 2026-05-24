/**
 * DynamicFontScaler
 *
 * Conservative cascade font scaler for Arabic manga text.
 * Tries sizes from largest to smallest until the text block fits within
 * the OCR bbox safe zone (82% of bubble dimensions).
 *
 * Uses measureLine() from ArabicTypesettingEngine for accurate block-width
 * checks — Canvas.measureText() on web, calibrated heuristic on native.
 *
 * Dialogue ladder : 20 → 18 → 16 → 14 → 12 → 10
 * SFX ladder      : 22 → 20 → 18 → 16 → 14
 * Hard floors     : 10 px dialogue, 14 px SFX (accepted even if overflowing)
 *
 * Line-height ratio is 1.35 — tighter than Latin, matches Arabic manga style.
 */

import {
  splitArabicText,
  estimateTextHeight,
  getSafeZone,
  measureLine,
} from "./ArabicTypesettingEngine";

const FONT_SIZE_LADDER = [20, 18, 16, 14, 12, 10] as const;
const LINE_HEIGHT_RATIO = 1.35;

export interface ScaledTypeset {
  fontSize: number;
  lines: string[];
  lineHeight: number;
}

/**
 * scaleFontToFit — fits Arabic dialogue / narration text into the bubble safe zone.
 *
 * Tries each size in the ladder until the rendered block fits within safeW × safeH.
 * Falls through to 10 px if nothing fits (accepted regardless — never cut text).
 */
export function scaleFontToFit(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);

  for (const fontSize of FONT_SIZE_LADDER) {
    const lines = splitArabicText(text, safeW, fontSize);
    const blockW = Math.max(...lines.map((l) => measureLine(l, fontSize)));
    const blockH = estimateTextHeight(lines.length, fontSize, LINE_HEIGHT_RATIO);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * LINE_HEIGHT_RATIO };
    }
  }

  // Hard floor — 10 px accepted even if technically overflowing
  const fallback = splitArabicText(text, safeW, 10);
  return { fontSize: 10, lines: fallback, lineHeight: 10 * LINE_HEIGHT_RATIO };
}

/**
 * scaleSFXFont — for short sound-effect / emphasis bursts.
 * Larger initial sizes and tighter line-height since SFX are typically 1–2 words.
 */
export function scaleSFXFont(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);
  const sfxLadder = [22, 20, 18, 16, 14] as const;
  const sfxLHR = 1.2;

  for (const fontSize of sfxLadder) {
    const lines = splitArabicText(text, safeW, fontSize);
    const blockW = Math.max(...lines.map((l) => measureLine(l, fontSize)));
    const blockH = estimateTextHeight(lines.length, fontSize, sfxLHR);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * sfxLHR };
    }
  }

  const fallback = splitArabicText(text, safeW, 14);
  return { fontSize: 14, lines: fallback, lineHeight: 14 * sfxLHR };
}
