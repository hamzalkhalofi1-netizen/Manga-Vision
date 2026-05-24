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
 *     producing symmetrical centered Arabic text inside speech bubbles.
 */

// ─── Font constants (shared with SkiaOverlayCanvas) ───────────────────────────

/**
 * Font stack — ordered by Arabic rendering quality.
 * MUST match the fontFamily applied to the Text component in SkiaOverlayCanvas.
 */
export const ARABIC_FONT_FAMILY =
  '"Noto Naskh Arabic", "Geeza Pro", "Noto Sans Arabic", "Segoe UI", Arial, sans-serif';

export const ARABIC_FONT_WEIGHT = "bold";

// ─── Safe zone ────────────────────────────────────────────────────────────────

/** 10% inward on each side → 80% of available dimensions. */
export function getSafeZone(w: number, h: number): { safeW: number; safeH: number } {
  return { safeW: w * 0.80, safeH: h * 0.80 };
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
      _ctxFont = font;
    }
    return _ctx;
  } catch {
    return null;
  }
}

/**
 * measureLine — returns the rendered pixel width of a text string.
 *
 * Web:    Canvas.measureText() with the actual matched font — accurate to the
 *         glyph including ligatures, cursive joins, and diacritics.
 * Native: Heuristic — Arabic connected forms average ~0.52 × fontSize per
 *         character (substantially narrower than Latin's ~0.62).
 */
export function measureLine(text: string, fontSize: number): number {
  if (!text) return 0;
  const ctx = getCtx(fontSize);
  if (ctx) return ctx.measureText(text).width;
  // Native fallback — Arabic glyphs are compact in connected form
  return text.length * fontSize * 0.52;
}

// ─── Line splitting ───────────────────────────────────────────────────────────

/**
 * greedyWrap — fills lines with whole words until the next word would exceed
 * maxW.  A word that is itself wider than maxW goes on its own line untouched
 * (never character-split — that destroys Arabic shaping).
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
      current = word; // start fresh — NEVER split the word
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [words.join(" ")];
}

/**
 * balanceLines — redistributes words so that all lines have similar visual
 * widths, improving the symmetry of centered Arabic text.
 *
 * Strategy:
 *   • Measure the full single-line width.
 *   • Divide by target line count to get a per-line target.
 *   • Re-wrap at that target (with 15% slack to avoid choppy rhythm).
 *   • Accept only if the result does not produce MORE lines than the input.
 */
function balanceLines(
  words: string[],
  lineCount: number,
  safeW: number,
  fontSize: number
): string[] {
  if (lineCount <= 1 || words.length <= 1) return [words.join(" ")];

  const totalW = measureLine(words.join(" "), fontSize);
  const targetW = Math.min(safeW, (totalW / lineCount) * 1.15);

  const balanced = greedyWrap(words, targetW, fontSize);
  return balanced;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * splitArabicText — primary export.
 *
 * 1. Greedy-wrap at safeW to determine the minimum required line count.
 * 2. Balance pass redistributes words for visual symmetry.
 * Returns an array of line strings; join with "\n" for React Native Text.
 */
export function splitArabicText(
  text: string,
  safeW: number,
  fontSize: number
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [""];

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return [trimmed];

  // Step 1: establish minimum line count via greedy wrap
  const wrapped = greedyWrap(words, safeW, fontSize);

  // Step 2: balance only if multi-line; keep result if it doesn't add lines
  if (wrapped.length > 1) {
    const balanced = balanceLines(words, wrapped.length, safeW, fontSize);
    if (balanced.length <= wrapped.length) return balanced;
  }

  return wrapped;
}

/**
 * estimateTextHeight — rendered height of a text block.
 */
export function estimateTextHeight(
  lineCount: number,
  fontSize: number,
  lineHeightMultiplier = 1.45
): number {
  return lineCount * fontSize * lineHeightMultiplier;
}
