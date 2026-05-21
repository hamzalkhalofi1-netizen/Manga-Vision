/**
 * ArabicTypesettingEngine
 *
 * Splits Arabic text into balanced, centered lines that fit within a safe
 * rendering zone (10% inward from bubble bounds on each side).
 *
 * Strategy:
 *  1. Split on word boundaries (Arabic words separated by spaces).
 *  2. Greedily fill lines up to maxCharsPerLine.
 *  3. Run a balancing pass to even out line lengths for centered composition.
 */

/** Returns the safe rendering zone dimensions (10% inward on each side). */
export function getSafeZone(w: number, h: number): { safeW: number; safeH: number } {
  return {
    safeW: w * 0.80,
    safeH: h * 0.80,
  };
}

/**
 * Estimate how many characters of Arabic text fit on one line at the given
 * font size. Average Arabic glyph width ≈ fontSize × 0.60.
 */
function estimateCharsPerLine(safeW: number, fontSize: number): number {
  const avgGlyphW = fontSize * 0.60;
  return Math.max(3, Math.floor(safeW / avgGlyphW));
}

/**
 * Greedy word-wrap: build lines without exceeding maxCharsPerLine.
 */
function greedyWrap(words: string[], maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (word.length > maxCharsPerLine) {
        const mid = Math.ceil(word.length / 2);
        lines.push(word.slice(0, mid));
        current = word.slice(mid);
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Balance pass: redistribute words across N lines to equalise line lengths,
 * improving visual symmetry for centered Arabic text.
 */
function balanceLines(lines: string[]): string[] {
  if (lines.length <= 1) return lines;

  const allWords = lines.join(" ").split(/\s+/).filter(Boolean);
  const totalChars = allWords.join(" ").length;
  const targetLen = Math.ceil(totalChars / lines.length);

  const balanced: string[] = [];
  let current = "";

  for (const word of allWords) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= targetLen * 1.15) {
      current = candidate;
    } else {
      balanced.push(current);
      current = word;
    }
  }
  if (current) balanced.push(current);
  return balanced;
}

/**
 * Primary export: split Arabic text into balanced, safe-zone-fitting lines.
 *
 * Returns an array of line strings. Join with "\n" for React Native Text.
 */
export function splitArabicText(
  text: string,
  safeW: number,
  fontSize: number
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [text];

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return [trimmed];

  const maxCharsPerLine = estimateCharsPerLine(safeW, fontSize);
  const wrapped = greedyWrap(words, maxCharsPerLine);
  return balanceLines(wrapped);
}

/**
 * Estimate the rendered height of text given font size, line count, and line height multiplier.
 */
export function estimateTextHeight(
  lineCount: number,
  fontSize: number,
  lineHeightMultiplier = 1.45
): number {
  return lineCount * fontSize * lineHeightMultiplier;
}
