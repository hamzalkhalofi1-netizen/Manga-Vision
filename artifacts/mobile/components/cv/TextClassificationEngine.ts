/**
 * TextClassificationEngine
 *
 * Canonicalises Gemini's raw type field into one of eight structured
 * text classes and determines whether each region should be translated,
 * inpainted, and rendered.
 *
 * Classification pipeline (each stage may override the previous):
 *   1. Content-pattern matching (URLs, © symbols, chapter markers) — highest
 *   2. Gemini type field → canonical class — primary signal
 *   3. Position heuristics (full-width header/footer strip) — secondary
 *   4. Dimension heuristics (tiny region, full-width narration) — lowest
 *
 * ┌────────────────┬───────────┬─────────┬────────┐
 * │ Class          │ translate │ inpaint │ render │
 * ├────────────────┼───────────┼─────────┼────────┤
 * │ speech_bubble  │ ✅        │ ✅      │ ✅     │
 * │ narration_box  │ ✅        │ ✅      │ ✅     │
 * │ sfx            │ ❌        │ ✅      │ ❌     │
 * │ ui_text (sign) │ ✅        │ ✅      │ ✅     │
 * │ chapter_title  │ ❌        │ ❌      │ ❌     │
 * │ credits        │ ❌        │ ❌      │ ❌     │
 * │ watermark      │ ❌        │ ❌      │ ❌     │
 * │ unknown        │ ❌        │ ❌      │ ❌     │
 * └────────────────┴───────────┴─────────┴────────┘
 *
 * sfx are inpainted (English SFX removed) but not re-rendered in Arabic
 * because Arabic SFX equivalents are not yet typeset-ready.
 *
 * ui_text (signs/labels) are translated and rendered because they often
 * carry story-relevant information (shop names, directions, notices).
 */

export type TextClass =
  | "speech_bubble"
  | "narration_box"
  | "sfx"
  | "chapter_title"
  | "credits"
  | "watermark"
  | "ui_text"
  | "unknown";

export interface ClassificationResult {
  textClass: TextClass;
  confidence: number;
  shouldTranslate: boolean;
  shouldInpaint: boolean;
  shouldRender: boolean;
  reason: string;
}

export interface ClassifiableRegion {
  original?: string;
  translated?: string;
  type?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Content-pattern tables ─────────────────────────────────────────────────────

const URL_PATTERN =
  /https?:\/\/|www\.|\.com[\s/]|\.net[\s/]|\.org[\s/]|\.io[\s/]/i;

const CREDITS_KEYWORDS =
  /\b(scanlat|translator|translat|editor|clean(er|ing)|typeset|redraw|proofreader|quality.?check|group:|team:|source:)\b|©|\(c\)/i;

const CHAPTER_PATTERNS = [
  /^ch(apter|\.)\s*\d+/i,
  /^vol(ume|\.)?\s*\d+/i,
  /^episode\s*\d+/i,
  /^page\s*\d+$/i,
  /^\d+$/,
];

const WATERMARK_SIGNALS =
  /\[?\s*(official|fan.?trans|read.?online|mangaplus|mangadex|viz|webtoon|tapas|toonily|mangatx|manhwatop|asura|bato)\s*\]?/i;

function isUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

function isCredits(text: string): boolean {
  return CREDITS_KEYWORDS.test(text);
}

function isChapterMarker(text: string): boolean {
  const t = text.trim();
  return CHAPTER_PATTERNS.some((rx) => rx.test(t));
}

function isWatermark(text: string, region: ClassifiableRegion): boolean {
  if (WATERMARK_SIGNALS.test(text)) return true;
  const { x, y, w, h } = region;
  const area = w * h;
  const isCorner =
    area < 0.004 &&
    ((x > 0.75 && y > 0.90) ||
      (x < 0.10 && y > 0.90) ||
      (x > 0.75 && y < 0.05) ||
      (x < 0.10 && y < 0.05));
  return isCorner;
}

// ── Gemini type → canonical class ─────────────────────────────────────────────

const GEMINI_TYPE_MAP: Record<string, TextClass> = {
  speech: "speech_bubble",
  thought: "speech_bubble",
  narration: "narration_box",
  sfx: "sfx",
  sign: "ui_text",
  title: "chapter_title",
  credits: "credits",
  watermark: "watermark",
  label: "ui_text",
  caption: "narration_box",
  whisper: "speech_bubble",
  shout: "speech_bubble",
  phone: "speech_bubble",
};

// ── Per-class rendering policy ─────────────────────────────────────────────────

const CLASS_POLICY: Record<
  TextClass,
  { translate: boolean; inpaint: boolean; render: boolean }
> = {
  speech_bubble: { translate: true,  inpaint: true,  render: true  },
  narration_box: { translate: true,  inpaint: true,  render: true  },
  sfx:           { translate: false, inpaint: true,  render: false },
  ui_text:       { translate: true,  inpaint: true,  render: true  },
  chapter_title: { translate: false, inpaint: false, render: false },
  credits:       { translate: false, inpaint: false, render: false },
  watermark:     { translate: false, inpaint: false, render: false },
  unknown:       { translate: false, inpaint: false, render: false },
};

function makeResult(
  cls: TextClass,
  confidence: number,
  reason: string
): ClassificationResult {
  const { translate, inpaint, render } = CLASS_POLICY[cls];
  return {
    textClass: cls,
    confidence,
    shouldTranslate: translate,
    shouldInpaint: inpaint,
    shouldRender: render,
    reason,
  };
}

// ── Main classifier ────────────────────────────────────────────────────────────

/**
 * Classify a single region.
 *
 * @param region   Region object (must include x/y/w/h and optional type/text).
 * @returns        ClassificationResult with rendering policy flags.
 */
export function classifyRegion(region: ClassifiableRegion): ClassificationResult {
  const { x, y, w, h, type: geminiType } = region;
  const text = (region.original ?? region.translated ?? "").trim();
  const area = w * h;

  // ── Stage 1: Content patterns (highest priority) ───────────────────────────

  if (text && isUrl(text)) {
    return makeResult("watermark", 0.97, "url-pattern");
  }
  if (text && isCredits(text)) {
    return makeResult("credits", 0.92, "credits-keyword");
  }
  if (text && isChapterMarker(text)) {
    return makeResult("chapter_title", 0.88, "chapter-pattern");
  }
  if (isWatermark(text, region)) {
    return makeResult("watermark", 0.85, "watermark-signal");
  }

  // ── Stage 2: Gemini type field ─────────────────────────────────────────────

  if (geminiType) {
    const mapped = GEMINI_TYPE_MAP[geminiType.toLowerCase()];
    if (mapped) {
      return makeResult(mapped, 0.82, `gemini:${geminiType}`);
    }
  }

  // ── Stage 3: Position heuristics ──────────────────────────────────────────

  const isFullWidthBanner = w > 0.72;
  const isTopStrip = y < 0.10 && h < 0.12;
  const isBottomStrip = y + h > 0.92 && h < 0.10;

  if (isFullWidthBanner && isTopStrip) {
    return makeResult("chapter_title", 0.75, "full-width-top-banner");
  }
  if (isFullWidthBanner && isBottomStrip) {
    return makeResult("credits", 0.70, "full-width-bottom-strip");
  }
  if (isBottomStrip && w < 0.30) {
    return makeResult("watermark", 0.68, "corner-bottom-strip");
  }

  // ── Stage 4: Dimension heuristics ─────────────────────────────────────────

  if (area < 0.0008) {
    return makeResult("unknown", 0.60, "too-small");
  }

  // ── Fallback: treat as speech bubble ──────────────────────────────────────

  return makeResult("speech_bubble", 0.45, "fallback-speech");
}

// ── Batch classifier ───────────────────────────────────────────────────────────

export interface ClassifiedRegion<T extends ClassifiableRegion = ClassifiableRegion> {
  region: T;
  classification: ClassificationResult;
}

/**
 * Classify an array of regions and return the annotated set.
 * Filters out unknown/zero-confidence regions only when filterUnknown is true.
 */
export function classifyRegions<T extends ClassifiableRegion>(
  regions: T[],
  filterUnknown = false
): ClassifiedRegion<T>[] {
  const out: ClassifiedRegion<T>[] = [];
  for (const region of regions) {
    const classification = classifyRegion(region);
    if (filterUnknown && classification.textClass === "unknown") continue;
    out.push({ region, classification });
  }
  return out;
}

/**
 * Filter regions to only those that should be sent to the CV inpainting pipeline.
 * Skips chapter titles, credits, and watermarks that don't need inpainting.
 */
export function filterForInpainting<T extends ClassifiableRegion>(regions: T[]): T[] {
  return regions.filter((r) => {
    const c = classifyRegion(r);
    return c.shouldInpaint;
  });
}

/**
 * Filter regions to only those that should be rendered after inpainting.
 */
export function filterForRendering<T extends ClassifiableRegion>(regions: T[]): T[] {
  return regions.filter((r) => {
    const c = classifyRegion(r);
    return c.shouldRender;
  });
}
