/**
 * geminiTranslate.ts
 *
 * Direct Gemini OCR + translation — runs entirely on-device.
 * No backend server required. Uses the user's own Gemini API key.
 *
 * Architecture:
 *   imageUrl → fetch (with CDN hotlink headers) → base64
 *             → Gemini 2.5 Flash (OCR + translate)
 *             → { regions, summary }
 */

import { GoogleGenAI } from "@google/genai";
import { getBasicImageHeaders } from "./sourceImageHeaders";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TranslatedRegion {
  original: string;
  translated: string;
  polygon?: [[number, number], [number, number], [number, number], [number, number]];
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  bgColor: string;
  textColor: string;
  speaker: string | null;
  emphasis: boolean;
  centroid?: { x: number; y: number };
  rotation?: number;
  centerX?: number;
  centerY?: number;
}

export interface TranslateResult {
  found: boolean;
  regions: TranslatedRegion[];
  summary: string;
}

// ── Language map ───────────────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  pt: "Portuguese (Brazilian)",
  fr: "French",
  de: "German",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  ar: "Arabic",
};

// ── Image fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch a CDN image and return it as a base64 string.
 * Uses per-source Referer headers to bypass hotlink protection.
 * Works in React Native (uses fetch + FileReader polyfill).
 */
async function fetchImageAsBase64(
  imageUrl: string,
  sourceId: string
): Promise<{ data: string; mimeType: string }> {
  const headers = getBasicImageHeaders(sourceId);

  console.log(`[geminiTranslate] Fetching image: ${imageUrl.substring(0, 80)}...`);

  const response = await fetch(imageUrl, { headers });

  if (!response.ok) {
    throw new Error(`Image fetch failed (HTTP ${response.status}): ${imageUrl.substring(0, 80)}`);
  }

  const blob = await response.blob();
  const mimeType = (blob.type || "image/jpeg").split(";")[0].trim();

  console.log(`[geminiTranslate] Image fetched OK — mimeType=${mimeType} size=${blob.size}B`);

  return new Promise<{ data: string; mimeType: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("FileReader produced empty base64"));
        return;
      }
      resolve({ data: base64, mimeType });
    };
    reader.onerror = () => reject(new Error("FileReader error reading image blob"));
    reader.readAsDataURL(blob);
  });
}

// ── Polygon geometry helpers ───────────────────────────────────────────────────

function computeCentroid(poly: [number, number][]): { x: number; y: number } {
  const n = poly.length;
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-8) {
    return {
      x: poly.reduce((s, [x]) => s + x, 0) / n,
      y: poly.reduce((s, [, y]) => s + y, 0) / n,
    };
  }
  return {
    x: Math.max(0, Math.min(1, cx / (6 * area))),
    y: Math.max(0, Math.min(1, cy / (6 * area))),
  };
}

function computeRotation(poly: [number, number][]): number {
  if (poly.length < 2) return 0;
  const dx = poly[1][0] - poly[0][0];
  const dy = poly[1][1] - poly[0][1];
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  deg = Math.max(-30, Math.min(30, deg));
  return Math.abs(deg) < 2 ? 0 : Math.round(deg * 10) / 10;
}

function bboxToPolygon(
  x: number,
  y: number,
  w: number,
  h: number
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function validatePolygon(
  raw: unknown
): [[number, number], [number, number], [number, number], [number, number]] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const pts = raw.map((p) => {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (isNaN(x) || isNaN(y)) return null;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [number, number];
  });
  if (pts.some((p) => p === null)) return null;
  const valid = pts as [number, number][];
  while (valid.length < 4) valid.push(valid[valid.length - 1]);
  return [valid[0], valid[1], valid[2], valid[3]];
}

// ── Gemini prompt ──────────────────────────────────────────────────────────────

function buildPrompt(targetLanguage: string): string {
  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const isRTL = targetLanguage === "ar";

  return `You are a professional manga/manhwa OCR and translation engine.

TASK: Analyze this manga/manhwa page. For EVERY visible piece of text — dialogue, sound effects, signs, narration — do ALL of the following:

1. LOCATE the text precisely:
   - polygon: tight quadrilateral around the actual text characters (4 [x,y] normalized points, clockwise from top-left)
   - x, y: top-left corner of the text area (normalized 0.0–1.0)
   - w, h: width and height of the text area as fractions of the image size
   Coordinates MUST wrap the TEXT GLYPHS ONLY — not the speech bubble outline.

2. DETECT the color immediately behind the text:
   - bgColor: hex of the pixel area directly behind the text characters (e.g. "#ffffff" white, "#1a1a1a" dark)
   - textColor: hex of the original text color (e.g. "#000000" black, "#ffffff" white)

3. CLASSIFY the rendering style:
   - "speech":    dialogue inside a speech bubble
   - "thought":   text inside a thought bubble
   - "sfx":       large stylized sound effects
   - "sign":      environmental labels, signs, titles
   - "narration": rectangular caption/narration boxes
   - "title":     chapter or volume title cards

4. TRANSLATE to ${langName}:
   ${isRTL
    ? "- Natural, emotionally vivid Arabic — manga-localized, NOT robotic. Proper MSA with character voice and emotional flair.\n   - Sound effects: Arabic SFX equivalents or creative transliteration\n   - Preserve exclamations, ellipses, emphasis"
    : `- Natural, idiomatic ${langName} — emotionally faithful, not literal\n   - Sound effects: equivalent ${langName} SFX or transliteration\n   - Preserve exclamations, ellipses, emphasis`}

Return ONLY valid JSON — no markdown, no backticks, no commentary:
{
  "found": true,
  "regions": [
    {
      "original": "source text",
      "translated": "${langName} translation",
      "polygon": [[0.05,0.03],[0.47,0.03],[0.47,0.14],[0.05,0.14]],
      "x": 0.05, "y": 0.03, "w": 0.42, "h": 0.11,
      "type": "speech",
      "bgColor": "#ffffff",
      "textColor": "#000000",
      "speaker": null,
      "emphasis": false
    }
  ],
  "summary": "One sentence describing what happens on this page."
}

RULES:
- polygon: exactly 4 [x,y] points wrapping the TEXT ONLY — never the bubble outline
- All coordinates in range 0.0–1.0
- Every separate text block is its own region — never merge distinct text areas
- If no text found: { "found": false, "regions": [], "summary": "No text on this page" }`;
}

const MODEL = "gemini-2.5-flash";
const MAX_ATTEMPTS = 4;

// ── Text translation (for descriptions, etc.) ─────────────────────────────────

/**
 * Translate a plain text string directly using the Gemini API.
 * Used for manga descriptions on the manga detail screen.
 *
 * @param text           Text to translate
 * @param targetLanguage BCP-47 language code
 * @param userApiKey     User's Gemini API key
 * @param context        Optional context hint (e.g. "Manga description for: One Piece")
 */
export async function translateText(
  text: string,
  targetLanguage: string,
  userApiKey: string,
  context?: string
): Promise<string> {
  if (!userApiKey) {
    throw new Error("No Gemini API key. Open Settings → Gemini API Keys and add your key.");
  }
  if (!text.trim()) throw new Error("Text is empty");

  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

  const prompt = `You are an expert manga and manhwa localizer with deep knowledge of anime culture, Japanese/Korean storytelling conventions, and emotional nuance in comics.

Your task: Translate the following text to ${langName}.

Translation requirements:
- Preserve the EXACT emotional tone, character personality, and dramatic intensity
- Match the style of official professional localizations (not literal word-for-word)
- Preserve comedy timing, action impact, and romantic tension
- Use natural, idiomatic ${langName} that feels native — never robotic or machine-translated
- Maintain honorifics or cultural references where appropriate for the target language
- Keep exclamations, sound effects, and emphatic punctuation that match the mood
${context ? `\nContext: ${context}` : ""}

Text to translate:
${text}

Return ONLY the translated text with no preamble, no explanations, no quotes around it.`;

  console.log(`[geminiTranslate] translateText — lang=${targetLanguage} chars=${text.length}`);

  const client = new GoogleGenAI({ apiKey: userApiKey });

  const response = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 8192 },
  });

  const result = response.text?.trim() ?? "";
  if (!result) throw new Error("Translation returned empty result");

  console.log(`[geminiTranslate] translateText success — ${result.length} chars`);
  return result;
}

// ── Main translate function ────────────────────────────────────────────────────

/**
 * Translate a single manga page directly using the Gemini API.
 *
 * @param imageUrl      CDN URL of the page image
 * @param targetLanguage  BCP-47 language code (en, ar, es, etc.)
 * @param userApiKey    User's Gemini API key (from Settings → AI Keys)
 * @param sourceId      Manga source ID for CDN header selection (default: "mangadex")
 */
export async function translateImage(
  imageUrl: string,
  targetLanguage: string,
  userApiKey: string,
  sourceId: string = "mangadex"
): Promise<TranslateResult> {
  if (!userApiKey) {
    throw new Error("No Gemini API key. Open Settings → Gemini API Keys and add your key.");
  }

  console.log(`[geminiTranslate] Starting OCR+translate — lang=${targetLanguage} source=${sourceId}`);
  console.log(`[geminiTranslate] URL: ${imageUrl.substring(0, 100)}`);

  const { data: imageData, mimeType } = await fetchImageAsBase64(imageUrl, sourceId);
  const prompt = buildPrompt(targetLanguage);
  const resolvedMime = mimeType as "image/jpeg" | "image/png" | "image/webp";

  const client = new GoogleGenAI({ apiKey: userApiKey });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`[geminiTranslate] Gemini request start — attempt ${attempt}/${MAX_ATTEMPTS}`);

      const response = await client.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: resolvedMime, data: imageData } },
              { text: prompt },
            ],
          },
        ],
        config: { maxOutputTokens: 8192 },
      });

      const raw = response.text?.trim() ?? "";
      console.log(`[geminiTranslate] Gemini response received — raw length=${raw.length}`);

      let parsed: {
        found: boolean;
        regions: Array<{
          original: string;
          translated: string;
          polygon?: unknown;
          x: number;
          y: number;
          w: number;
          h: number;
          type: string;
          bgColor: string;
          textColor: string;
          speaker: string | null;
          emphasis: boolean;
        }>;
        summary: string;
      };

      try {
        parsed = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        parsed = match
          ? (() => {
              try {
                return JSON.parse(match[0]);
              } catch {
                return { found: false, regions: [], summary: "Could not parse AI response" };
              }
            })()
          : { found: false, regions: [], summary: "No parseable response" };
      }

      const processedRegions: TranslatedRegion[] = (parsed.regions ?? [])
        .filter((r) => r && typeof r.x === "number" && typeof r.y === "number")
        .map((r) => {
          const cx = Math.max(0, Math.min(0.99, r.x));
          const cy = Math.max(0, Math.min(0.99, r.y));
          const cw = Math.max(0.02, Math.min(1 - cx, r.w));
          const ch = Math.max(0.02, Math.min(1 - cy, r.h));

          const polygon = validatePolygon(r.polygon) ?? bboxToPolygon(cx, cy, cw, ch);
          const centroid = computeCentroid(polygon);
          const rotation = computeRotation(polygon);

          return {
            original: r.original ?? "",
            translated: r.translated ?? "",
            x: cx,
            y: cy,
            w: cw,
            h: ch,
            polygon,
            centroid,
            rotation,
            centerX: centroid.x,
            centerY: centroid.y,
            type: r.type ?? "speech",
            bgColor: r.bgColor || "#ffffff",
            textColor: r.textColor || "#000000",
            emphasis: !!r.emphasis,
            speaker: r.speaker || null,
          };
        });

      console.log(
        `[geminiTranslate] Translation success — regions=${processedRegions.length} attempt=${attempt}`
      );

      return {
        found: parsed.found ?? processedRegions.length > 0,
        regions: processedRegions,
        summary: parsed.summary ?? "",
      };
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string; code?: number };
      const errMsg = anyErr?.message ?? String(err);

      console.error(`[geminiTranslate] Attempt ${attempt} failed: ${errMsg}`);

      if (
        anyErr?.status === 400 &&
        (errMsg.includes("API_KEY_INVALID") || errMsg.includes("API key not valid"))
      ) {
        throw new Error(
          "API_KEY_INVALID: Your Gemini API key is not valid or has been revoked. " +
          "Open Settings → Gemini API Keys, remove it and add a working key."
        );
      }

      if (anyErr?.status === 429 || anyErr?.code === 429) {
        throw new Error("RATE_LIMITED");
      }

      if ((anyErr?.status === 503 || anyErr?.status === 500) && attempt < MAX_ATTEMPTS) {
        const delay = attempt * 5000;
        console.warn(`[geminiTranslate] Gemini overloaded, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Translation failed after ${MAX_ATTEMPTS} attempts: ${errMsg}`);
      }
    }
  }

  throw new Error("Translation failed: exhausted all retry attempts");
}
