/**
 * DynamicFontScaler — professional manga-quality font cascade for Arabic.
 *
 * Tries font sizes from largest to smallest until the text block fits within
 * the bubble safe zone (85% of bubble AABB dimensions).
 *
 * Architecture:
 *   • Bubble AABB (axis-aligned bounding box of detected speech bubble polygon)
 *     is the reference dimension passed in as bubbleW × bubbleH.
 *   • Safe zone = 85% of those dimensions.
 *   • Font cascade returns the LARGEST size where all wrapped lines fit within
 *     safeW × safeH. Never uses a size that causes overflow.
 *
 * Dialogue ladder : 24 → 22 → 20 → 18 → 16 → 14 → 12 → 10 → 8
 * SFX ladder      : 30 → 28 → 26 → 24 → 22 → 20 → 18 → 16 → 14
 *
 * Hard floors: 8 px dialogue, 14 px SFX (accepted even if technically
 * overflowing — never cut text, never render nothing).
 *
 * Line-height ratio: 1.3 — tight but readable, matches professional
 * manga scanlation spacing. Arabic needs less interline space than Latin.
 * estimateTextHeight applies a further 10% buffer for diacritics.
 */

import {
  splitArabicText,
  estimateTextHeight,
  getSafeZone,
  measureLine,
} from "./ArabicTypesettingEngine";

const FONT_SIZE_LADDER = [24, 22, 20, 18, 16, 14, 12, 10, 8] as const;
const LINE_HEIGHT_RATIO = 1.3;

export interface ScaledTypeset {
  fontSize:   number;
  lines:      string[];
  lineHeight: number;
}

/**
 * scaleFontToFit — fits Arabic dialogue / narration text into the safe zone.
 *
 * @param text     Full translated Arabic text
 * @param bubbleW  Bubble AABB width in pixels
 * @param bubbleH  Bubble AABB height in pixels
 */
export function scaleFontToFit(
  text: string,
  bubbleW: number,
  bubbleH: number,
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);

  for (const fontSize of FONT_SIZE_LADDER) {
    const lines  = splitArabicText(text, safeW, fontSize);
    const blockW = lines.length === 0 ? 0 : Math.max(...lines.map((l) => measureLine(l, fontSize)));
    const blockH = estimateTextHeight(lines.length, fontSize, LINE_HEIGHT_RATIO);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * LINE_HEIGHT_RATIO };
    }
  }

  // Hard floor — 8 px always accepted
  const fallback = splitArabicText(text, safeW, 8);
  return { fontSize: 8, lines: fallback, lineHeight: 8 * LINE_HEIGHT_RATIO };
}

/**
 * scaleSFXFont — for sound-effect / emphasis text.
 *
 * Larger initial sizes since SFX are typically 1–2 words with no multiline.
 * Tighter line-height ratio (1.15) matches the compressed, punchy style of
 * manga sound effects.
 */
export function scaleSFXFont(
  text: string,
  bubbleW: number,
  bubbleH: number,
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);
  const sfxLadder = [30, 28, 26, 24, 22, 20, 18, 16, 14] as const;
  const sfxLHR    = 1.15;

  for (const fontSize of sfxLadder) {
    const lines  = splitArabicText(text, safeW, fontSize);
    const blockW = lines.length === 0 ? 0 : Math.max(...lines.map((l) => measureLine(l, fontSize)));
    const blockH = estimateTextHeight(lines.length, fontSize, sfxLHR);

    if (blockW <= safeW && blockH <= safeH) {
      return { fontSize, lines, lineHeight: fontSize * sfxLHR };
    }
  }

  // Hard floor for SFX
  const fallback = splitArabicText(text, safeW, 14);
  return { fontSize: 14, lines: fallback, lineHeight: 14 * sfxLHR };
}
