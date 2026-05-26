/**
 * DynamicFontScaler
 *
 * Professional manga-quality font cascade for Arabic speech bubble text.
 *
 * Tries sizes from largest to smallest until the text block fits within
 * the OCR bbox safe zone (88% of OCR dimensions).
 *
 * Why 88%: The OCR polygon from Gemini is glyph-tight (original text bounds,
 * not the full speech bubble). 88% gives the Arabic text a small breathing
 * margin for diacritics and descenders without excessive shrinking.
 *
 * Uses measureLine() from ArabicTypesettingEngine for accurate block-width
 * checks — Canvas.measureText() on web, calibrated heuristic on native.
 *
 * Dialogue ladder : 22 → 20 → 18 → 16 → 14 → 12 → 10
 * SFX ladder      : 26 → 24 → 22 → 20 → 18 → 16
 * Hard floors     : 10 px dialogue, 16 px SFX (accepted even if overflowing)
 *
 * Line-height ratio is 1.3 — tight but readable, matches professional
 * manga scanlation spacing. Arabic needs less interline space than Latin.
 */

import {
  splitArabicText,
  estimateTextHeight,
  getSafeZone,
  measureLine,
} from "./ArabicTypesettingEngine";

const FONT_SIZE_LADDER = [22, 20, 18, 16, 14, 12, 10] as const;
const LINE_HEIGHT_RATIO = 1.3;

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
 *
 * Larger initial sizes since SFX are typically 1–2 words with no multiline.
 * Tighter line-height ratio (1.15) matches the compressed, punchy style of
 * manga sound effects.
 */
export function scaleSFXFont(
  text: string,
  bubbleW: number,
  bubbleH: number
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);
  const sfxLadder = [26, 24, 22, 20, 18, 16] as const;
  const sfxLHR = 1.15;

  for (const fontSize of sfxLadder) {
    const lines = splitArabicText(text, safeW, fontSize);
    const blockW = Math.max(...lines.map((l) => measureLine(l, fontSize)));
    const blockH = estimateTextHeight(lines.length, fontSize, sfxLHR);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * sfxLHR };
    }
  }

  const fallback = splitArabicText(text, safeW, 16);
  return { fontSize: 16, lines: fallback, lineHeight: 16 * sfxLHR };
}
