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
 * Safe zone — 91% of polygon dimensions:
 *  The OCR polygon from Gemini is glyph-tight (wraps the original text glyphs,
 *  not the full speech bubble). 91% gives the Arabic text breathing room for
 *  diacritics (tashkeel) without over-shrinking.
 *
 *  The text CONTAINER is the full polygon area (ocrW × ocrH). Pre-wrapped
 *  lines fill ~91% of the container width, centered within the remaining 9%.
 *  This creates natural speech-bubble spacing that mirrors how scanlation
 *  teams leave a small margin between text and bubble edge.
 *
 *  Previously 88%, which was too conservative and forced the font cascade
 *  to drop to 10–12px (subtitle appearance). 91% produces larger, more
 *  natural-looking manga text while keeping everything within the polygon.
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
 * 4.5% margin on each side → 91% usable area.
 *
 * The text container is now the full OCR polygon (ocrW × ocrH).
 * Pre-wrapped lines are sized to fit in 91% of that width, giving
 * natural bubble breathing room that matches professional scanlations.
 *
 * Font sizing: the scaler tries each font size and checks if all wrapped
 * lines fit within safeW × safeH. If yes, use that size. If not, try
 * the next smaller size.
 */
export function getSafeZone(w: number, h: number): { safeW: number; safeH: number } {
  return { safeW: w * 0.91, safeH: h * 0.91 };
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
 *         ~0.47 × fontSize per character. Used for font SIZE selection only;
 *         actual text wrapping is performed by React Native's text engine.
 *
 * The 0.47 factor is intentionally slightly over-estimating to ensure the
 * scaler never chooses a font that React Native would then wrap incorrectly.
 * Over-estimation (choosing a smaller font step than strictly necessary) is
 * safe; under-estimation (choosing too large a font that then wraps badly)
 * is what causes text to overflow or look cramped.
 */
export function measureLine(text: string, fontSize: number): number {
  if (!text) return 0;
  const ctx = getCtx(fontSize);
  if (ctx) return ctx.measureText(text).width;
  // Native heuristic: Arabic connected script is compact.
  // 0.47 per character is empirically accurate for Noto Naskh Arabic Bold
  // at manga font sizes (10–24px). Intentionally slightly over-estimates.
  return text.length * fontSize * 0.47;
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
 *
 * NOTE: The resulting lines are PRE-WRAPPED to fit safeW (91% of ocrW).
 * They are rendered inside a container of ocrW width, so they appear centered
 * with ~9% breathing room on each side — exactly like manga scanlations.
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
 * Line-height multiplier 1.3 — tight but readable, matches professional
 * manga scanlation spacing inside speech bubbles. Arabic uses less interline
 * space than Latin in compact bubble contexts.
 */
export function estimateTextHeight(
  lineCount: number,
  fontSize: number,
  lineHeightMultiplier = 1.3,
): number {
  return lineCount * fontSize * lineHeightMultiplier;
}
