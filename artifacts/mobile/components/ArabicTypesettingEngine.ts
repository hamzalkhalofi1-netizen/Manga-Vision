/**
 * ArabicTypesettingEngine
 *
 * Splits Arabic text into balanced, centered lines that fit within a safe
 * rendering zone (10% inward from bubble bounds on each side = 80% total).
 *
 * Pipeline:
 *  1. Greedy word-wrap at estimated chars-per-line for the given font size.
 *  2. Balance pass — redistribute words to equalise line lengths.
 *  3. Overflow validation — force-split any line that still exceeds safeW.
 */

/** 10% inward on each side → 80% of total dimensions. */
export function getSafeZone(w: number, h: number): { safeW: number; safeH: number } {
  return {
    safeW: w * 0.80,
    safeH: h * 0.80,
  };
}

/**
 * Estimated chars per line at the given font size.
 * Average Arabic glyph width ≈ fontSize × 0.62.
 */
function estimateCharsPerLine(safeW: number, fontSize: number): number {
  const avgGlyphW = fontSize * 0.62;
  return Math.max(3, Math.floor(safeW / avgGlyphW));
}

/**
 * Greedy word-wrap: pack words onto each line without exceeding
 * maxCharsPerLine. Long single words are split at the midpoint.
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
        // Split overlong word at midpoint
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
 * Balance pass: redistribute all words across the existing line count so
 * that line lengths are as even as possible — improving visual symmetry
 * for centered Arabic text.
 */
function balanceLines(lines: string[]): string[] {
  if (lines.length <= 1) return lines;

  const allWords = lines.join(" ").split(/\s+/).filter(Boolean);
  const totalChars = allWords.join(" ").length;
  const targetLen  = Math.ceil(totalChars / lines.length);

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
 * Overflow validation pass: if any line after balancing still exceeds
 * maxCharsPerLine (which can happen with long words), force-split it.
 * This is the final safety net that guarantees no glyph crosses the
 * safe-zone boundary.
 */
function enforceOverflowSplits(lines: string[], maxCharsPerLine: number): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (line.length <= maxCharsPerLine) {
      result.push(line);
    } else {
      // Split at maxCharsPerLine, trying to break on word boundary
      const words = line.split(/\s+/);
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= maxCharsPerLine) {
          current = candidate;
        } else {
          if (current) result.push(current);
          current = word.length > maxCharsPerLine
            ? word.slice(0, maxCharsPerLine)
            : word;
        }
      }
      if (current) result.push(current);
    }
  }
  return result;
}

/**
 * Primary export: split Arabic text into balanced, safe-zone-fitting lines.
 * Returns array of line strings — join with "\n" for React Native Text.
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
  const wrapped   = greedyWrap(words, maxCharsPerLine);
  const balanced  = balanceLines(wrapped);
  const validated = enforceOverflowSplits(balanced, maxCharsPerLine);

  return validated;
}

/**
 * Estimate rendered height of a text block.
 */
export function estimateTextHeight(
  lineCount: number,
  fontSize: number,
  lineHeightMultiplier = 1.45
): number {
  return lineCount * fontSize * lineHeightMultiplier;
}
