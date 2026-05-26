/**
 * DynamicFontScaler — professional manga-quality font cascade for Arabic.
 *
 * Tries font sizes from largest to smallest until the text block fits within
 * the OCR polygon safe zone (91% of polygon dimensions).
 *
 * Integration with new SkiaOverlayCanvas architecture:
 *   • The TEXT CONTAINER is the full polygon area (ocrW × ocrH).
 *   • Font sizing uses 91% of those dimensions as the fitting target.
 *   • Pre-wrapped lines (from splitArabicText) fill ~91% of container width,
 *     leaving natural breathing room at the bubble edges.
 *   • The font cascade returns the LARGEST size where all wrapped lines
 *     fit within safeW × safeH. Never use a size that causes overflow.
 *
 * Dialogue ladder : 24 → 22 → 20 → 18 → 16 → 14 → 12 → 10
 * SFX ladder      : 30 → 28 → 26 → 24 → 22 → 20 → 18 → 16
 *
 * The extended ladders start at larger sizes because:
 *   • The text container is now polygon-sized (previously glyph-sized),
 *     so larger polygons can accommodate larger fonts than before.
 *   • The 91% safe zone (vs previous 88%) also allows larger text.
 *   • These two changes together increase the typical rendered font size
 *     by 2–4px, eliminating the subtitle-sized text appearance.
 *
 * Hard floors: 10 px dialogue, 16 px SFX (accepted even if technically
 * overflowing — never cut text, never render nothing).
 *
 * Line-height ratio: 1.3 — tight but readable, matches professional
 * manga scanlation spacing. Arabic needs less interline space than Latin.
 */

import {
  splitArabicText,
  estimateTextHeight,
  getSafeZone,
  measureLine,
} from "./ArabicTypesettingEngine";

// Extended ladder — starts at 24 (was 22) to allow larger text in
// properly-sized polygon containers.
const FONT_SIZE_LADDER = [24, 22, 20, 18, 16, 14, 12, 10] as const;
const LINE_HEIGHT_RATIO = 1.3;

export interface ScaledTypeset {
  fontSize:   number;
  lines:      string[];
  lineHeight: number;
}

/**
 * scaleFontToFit — fits Arabic dialogue / narration text into the safe zone.
 *
 * Tries each size in the ladder until the rendered block fits within
 * safeW × safeH. Falls through to 10 px if nothing fits (accepted
 * regardless — never cut text, never return empty).
 *
 * @param text     Full translated Arabic text (may contain spaces, no newlines)
 * @param bubbleW  Polygon width in pixels (ocrW)
 * @param bubbleH  Polygon height in pixels (ocrH)
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

  // Hard floor — 10 px always accepted
  const fallback = splitArabicText(text, safeW, 10);
  return { fontSize: 10, lines: fallback, lineHeight: 10 * LINE_HEIGHT_RATIO };
}

/**
 * scaleSFXFont — for sound-effect / emphasis text.
 *
 * Larger initial sizes since SFX are typically 1–2 words with no multiline.
 * Tighter line-height ratio (1.15) matches the compressed, punchy style of
 * manga sound effects. Extended to start at 30 (was 26) to take advantage
 * of the larger polygon-sized container.
 */
export function scaleSFXFont(
  text: string,
  bubbleW: number,
  bubbleH: number,
): ScaledTypeset {
  const { safeW, safeH } = getSafeZone(bubbleW, bubbleH);
  const sfxLadder = [30, 28, 26, 24, 22, 20, 18, 16] as const;
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
  const fallback = splitArabicText(text, safeW, 16);
  return { fontSize: 16, lines: fallback, lineHeight: 16 * sfxLHR };
}
