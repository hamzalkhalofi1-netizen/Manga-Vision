/**
 * ArabicTypesettingEngine — proper Arabic text measurement and line splitting.
 *
 * Core principles:
 *  1. NEVER split Arabic words — mid-word character slices break contextual
 *     glyph forms (initial / medial / final / isolated) and produce visually
 *     disconnected, mis-shaped text.
 *  2. Measure real rendered widths via Canvas.measureText() on web.
 *     Falls back to a calibrated heuristic on native (iOS / Android).
 *  3. Balance pass redistributes words so all lines have similar visual widths,
 *     producing symmetrical centred Arabic text inside speech bubbles.
 *
 * Platform Arabic shaping:
 *  - iOS:     Core Text with Geeza Pro / system Arabic — full ligature support
 *  - Android: HarfBuzz (built into Android text stack) — full OpenType support
 *  - Web:     Browser Unicode bidi + CSS writing-direction
 *
 * Safe zone — 85% of bubble AABB dimensions:
 *  Leaves 7.5% margin on each side of the bubble for natural breathing room.
 *  Arabic diacritics (tashkeel) extend above/below the baseline so the safe
 *  zone must accommodate them without clipping.
 */

// ─── Font constants (shared with SkiaOverlayCanvas) ───────────────────────────

/**
 * Font stack ordered by Arabic rendering quality on each platform.
 * MUST match the fontFamily applied to Text in SkiaOverlayCanvas.
 *
 * iOS:     Geeza Pro → excellent Arabic, system default
 * Android: Noto Naskh Arabic → bundled since Android 5.0
 * Web:     Noto Naskh Arabic → widely available
 */
export const ARABIC_FONT_FAMILY =
  '"Noto Naskh Arabic", "Geeza Pro", "Noto Sans Arabic", "Amiri", "Segoe UI", Arial, sans-serif';

export const ARABIC_FONT_WEIGHT = "bold";

// ─── Safe zone ────────────────────────────────────────────────────────────────

/**
 * 7.5% margin on each side → 85% usable area.
 *
 * The text container is the bubble AABB (axis-aligned bounding box of the
 * detected speech bubble polygon). 85% gives natural breathing room from the
 * bubble edges and accommodates Arabic diacritics without clipping.
 *
 * Font sizing: the scaler tries each font size and checks if all wrapped
 * lines fit within safeW × safeH. If yes, use that size. If not, try
 * the next smaller size.
 */
export function getSafeZone(w: number, h: number): { safeW: number; safeH: number } {
  return { safeW: w * 0.85, safeH: h * 0.85 };
}

// ─── Real font measurement ────────────────────────────────────────────────────

let _ctx: CanvasRenderingContext2D | null = null;
let _ctxFont = "";

/**
 * Returns a cached Canvas 2D context configured for the given font size.
 * Returns null on React Native (no DOM).
 */
function getCtx(fontSize: number): CanvasRenderingContext2D | null {
  try {
    if (typeof document === "undefined") return null;
    if (!_ctx) {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      _ctx = canvas.getContext("2d");
    }
    if (!_ctx) return null;
    const font = `${ARABIC_FONT_WEIGHT} ${fontSize}px ${ARABIC_FONT_FAMILY}`;
    if (font !== _ctxFont) {
      _ctx.font = font;
      _ctxFont  = font;
    }
    return _ctx;
  } catch {
    return null;
  }
}

/**
 * measureLine — returns the rendered pixel width of a text string.
 *
 * Web:    Canvas.measureText() — accurate glyph widths including ligatures,
 *         cursive joins, and diacritical marks.
 *
 * Native: Calibrated heuristic — Arabic connected forms in bold average
 *         ~0.52 × fontSize per character. Used for font SIZE selection only;
 *         actual text wrapping is performed by React Native's text engine.
 *
 * The 0.52 factor is intentionally slightly over-estimating to ensure the
 * scaler never chooses a font that React Native would then wrap incorrectly.
 */
export function measureLine(text: string, fontSize: number): number {
  if (!text) return 0;
  const ctx = getCtx(fontSize);
  if (ctx) return ctx.measureText(text).width;
  return text.length * fontSize * 0.52;
}

// ─── Line splitting ───────────────────────────────────────────────────────────

/**
 * greedyWrap — fills lines with whole words until the next word would exceed
 * maxW. A word wider than maxW goes on its own line untouched — never
 * character-split, which destroys Arabic contextual glyph shaping.
 */
function greedyWrap(words: string[], maxW: number, fontSize: number): string[] {
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || measureLine(candidate, fontSize) <= maxW) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [words.join(" ")];
}

/**
 * balanceLines — redistributes words so all lines have similar visual widths.
 *
 * Strategy:
 *   1. Measure full single-line width.
 *   2. Divide by target line count to get per-line target width.
 *   3. Re-wrap at that target (+10% slack to avoid choppy rhythm).
 *   4. Accept only if result does not produce MORE lines than input.
 *
 * This creates symmetrical, centred Arabic text that looks like professional
 * scanlation rather than ragged left/right aligned text.
 */
function balanceLines(
  words: string[],
  lineCount: number,
  safeW: number,
  fontSize: number,
): string[] {
  if (lineCount <= 1 || words.length <= 1) return [words.join(" ")];
  const totalW  = measureLine(words.join(" "), fontSize);
  const targetW = Math.min(safeW, (totalW / lineCount) * 1.10);
  const balanced = greedyWrap(words, targetW, fontSize);
  return balanced;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * splitArabicText — primary export.
 *
 * 1. Greedy-wrap at safeW to determine the minimum required line count.
 * 2. Balance pass redistributes words for visual symmetry.
 *
 * Returns an array of line strings. Joined with "\n" for React Native Text.
 */
export function splitArabicText(
  text: string,
  safeW: number,
  fontSize: number,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [""];

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return [trimmed];

  const wrapped = greedyWrap(words, safeW, fontSize);

  if (wrapped.length > 1) {
    const balanced = balanceLines(words, wrapped.length, safeW, fontSize);
    if (balanced.length <= wrapped.length) return balanced;
  }

  return wrapped;
}

/**
 * estimateTextHeight — rendered height of a text block.
 *
 * Adds 10% buffer above the mathematical height to accommodate Arabic
 * diacritics (tashkeel) and descenders that extend beyond the em-square.
 */
export function estimateTextHeight(
  lineCount: number,
  fontSize: number,
  lineHeightMultiplier = 1.3,
): number {
  return lineCount * fontSize * lineHeightMultiplier * 1.10;
}
