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
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getBasicImageHeaders } from "./sourceImageHeaders";
import { ImageLoader } from "./engine/imageLoader";
import { ImageDiskCache } from "./cache/ImageDiskCache";
import type { GeminiModel } from "./geminiKeyTest";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TranslatedRegion {
  original: string;
  translated: string;
  /** Tight 4-point polygon wrapping the text glyphs (normalized 0–1). */
  polygon?: [[number, number], [number, number], [number, number], [number, number]];
  /**
   * 4–8 point polygon tracing the FULL speech bubble outline.
   * Larger than polygon — covers the bubble border, tail, and pointer.
   * Used as the mask/erase boundary and text container boundary.
   * Falls back to an expanded OCR polygon when absent.
   */
  bubblePolygon?: [number, number][];
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

async function fetchImageAsBase64(
  imageUrl: string,
  sourceId: string
): Promise<{ data: string; mimeType: string }> {
  const headers = getBasicImageHeaders(sourceId);
  const startedAt = Date.now();

  // Native reader pages are already downloaded by ImageDiskCache. Reuse those
  // exact bytes instead of issuing a second JS fetch to the CDN. This matters
  // on Android: the reader's native FileSystem request can succeed even when a
  // JavaScript fetch to the same hotlink-protected URL fails with "Failed to
  // fetch".
  if (Platform.OS !== "web") {
    try {
      const localUri =
        (await ImageDiskCache.getPath(imageUrl)) ??
        (await ImageDiskCache.download(imageUrl, headers));
      const info = await FileSystem.getInfoAsync(localUri, { size: true } as any);
      const sizeBytes = (info as FileSystem.FileInfo & { size?: number }).size ?? 0;
      if (!info.exists || sizeBytes === 0) {
        throw new Error("Downloaded image is empty or corrupted");
      }

      const data = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!data) throw new Error("FileSystem returned empty base64");

      const mimeType = inferImageMimeType(imageUrl);
      console.log(
        `[TRANSLATION DEBUG] source=${sourceId} imageFetch=success imageSource=native-cache imageBytes=${sizeBytes} duration=${Date.now() - startedAt}ms`
      );
      return { data, mimeType };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[TRANSLATION DEBUG] source=${sourceId} imageFetch=failure imageSource=native-cache duration=${Date.now() - startedAt}ms errorCategory=IMAGE_FETCH_FAILED message=${message.slice(0, 180)}`
      );
      throw new Error(`IMAGE_FETCH_FAILED: Could not acquire the manga image (${message.slice(0, 180)}).`);
    }
  }

  // MangaPage already uses this existing proxy rewrite on web. Reuse it here
  // so the translation request sees the same CORS/hotlink-safe image URL as
  // the reader; native keeps the original URL and headers.
  const requestUrl = ImageLoader.maybeProxyUrl(imageUrl);
  const requestHost = (() => {
    try {
      return new URL(requestUrl).host;
    } catch {
      return "invalid-url";
    }
  })();

  console.log(
    `[TRANSLATION DEBUG] source=${sourceId} imageFetch=started imageSource=web-fetch host=${requestHost} proxied=${requestUrl !== imageUrl}`
  );

  let response: Response;
  const webFetchStartedAt = Date.now();
  try {
    response = await fetch(requestUrl, { headers });
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[TRANSLATION DEBUG] source=${sourceId} imageFetch=failure imageSource=web-fetch duration=${Date.now() - webFetchStartedAt}ms errorCategory=IMAGE_FETCH_FAILED name=${name} message=${message.slice(0, 160)}`
    );
    throw new Error(
      name === "AbortError"
        ? "IMAGE_FETCH_TIMEOUT: The manga image request timed out."
        : `IMAGE_FETCH_FAILED: Could not load the manga image (${message.slice(0, 160)}).`
    );
  }

  if (!response.ok) {
    console.error(
      `[TRANSLATION DEBUG] source=${sourceId} imageFetch=failure imageSource=web-fetch status=${response.status} contentType=${response.headers.get("content-type") ?? "unknown"} duration=${Date.now() - webFetchStartedAt}ms errorCategory=IMAGE_FETCH_FAILED`
    );
    throw new Error(`IMAGE_FETCH_FAILED: Manga image request returned HTTP ${response.status}.`);
  }

  const blob = await response.blob();
  const mimeType = (blob.type || "image/jpeg").split(";")[0].trim();

  console.log(
    `[TRANSLATION DEBUG] source=${sourceId} imageFetch=success imageSource=web-fetch imageBytes=${blob.size} contentType=${mimeType} duration=${Date.now() - webFetchStartedAt}ms`
  );

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

/**
 * validateBubblePolygon — accepts 3–12 point polygon for the full bubble outline.
 * Returns null if invalid; all coordinates clamped to [0,1].
 */
function validateBubblePolygon(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 16) return null;
  const pts: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (isNaN(x) || isNaN(y)) return null;
    pts.push([Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]);
  }
  return pts;
}

// ── Gemini prompt ──────────────────────────────────────────────────────────────

export interface TranslationOptions {
  model?: GeminiModel;
  style?: "literal" | "natural" | "professional" | "anime" | "custom";
  customStyle?: string;
  translateSFX?: boolean;
  translateNarration?: boolean;
  translateCredits?: boolean;
  keepOriginal?: boolean;
}

function buildPrompt(targetLanguage: string, options: TranslationOptions = {}): string {
  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const isRTL = targetLanguage === "ar";
  const styleInstruction = options.style === "custom"
    ? options.customStyle?.trim() || "natural and idiomatic"
    : options.style === "literal"
      ? "close to the source wording while remaining grammatical"
      : options.style === "professional"
        ? "polished and faithful to an official localization"
        : options.style === "anime"
          ? "emotionally vivid, characterful, and consistent with anime localization"
          : "natural and idiomatic";
  const typeInstruction = [
    options.translateSFX === false ? "Do not translate sound effects; omit SFX regions." : "",
    options.translateNarration === false ? "Do not translate narration boxes; omit narration regions." : "",
    options.translateCredits === false ? "Do not translate credits or metadata; omit credits regions." : "",
  ].filter(Boolean).join("\n");

  return `You are a professional manga/manhwa OCR and translation engine.

TASK: Analyze this manga/manhwa page. For EVERY visible piece of text — dialogue, sound effects, signs, narration — do ALL of the following:

1. LOCATE the text precisely:
   - polygon: tight quadrilateral around the actual text characters ONLY (4 [x,y] normalized points, clockwise from top-left). Wraps the INK GLYPHS, not the bubble.
   - bubblePolygon: 4-8 clockwise points tracing the FULL SPEECH BUBBLE OUTLINE (larger than polygon — includes the bubble border, tail, and pointer area). For SFX/signs/floating text with no bubble container, set bubblePolygon identical to polygon.
   - x, y: top-left corner of the text area (normalized 0.0–1.0)
   - w, h: width and height of the text area as fractions of the image size

2. DETECT the color immediately behind the text:
   - bgColor: hex of the pixel area directly behind the text characters (e.g. "#ffffff" white, "#1a1a1a" dark)
   - textColor: hex of the original text color (e.g. "#000000" black, "#ffffff" white)

3. CLASSIFY the rendering style:
   - "speech":    dialogue inside a speech bubble
   - "thought":   text inside a thought bubble
   - "sfx":       large stylized sound effects
   - "sign":      environmental labels, signs
   - "narration": rectangular caption/narration boxes
   - "title":     chapter or volume title cards
   - "credits":   scanlation group name, translator/editor/cleaner credits
   - "watermark": website URL or source watermark stamped on the page

4. TRANSLATE to ${langName}:
   ${isRTL
    ? "- Natural, emotionally vivid Arabic — manga-localized, NOT robotic. Proper MSA with character voice and emotional flair.\n   - Sound effects: Arabic SFX equivalents or creative transliteration\n   - Preserve exclamations, ellipses, emphasis"
   : `- ${styleInstruction} ${langName} — emotionally faithful\n   - Sound effects: equivalent ${langName} SFX or transliteration\n   - Preserve exclamations, ellipses, emphasis`}

${typeInstruction}

Return ONLY valid JSON — no markdown, no backticks, no commentary:
{
  "found": true,
  "regions": [
    {
      "original": "source text",
      "translated": "${langName} translation",
      "polygon": [[0.10,0.05],[0.42,0.05],[0.42,0.18],[0.10,0.18]],
      "bubblePolygon": [[0.04,0.01],[0.47,0.01],[0.49,0.21],[0.03,0.21]],
      "x": 0.10, "y": 0.05, "w": 0.32, "h": 0.13,
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
- polygon: exactly 4 [x,y] points wrapping the TEXT GLYPHS ONLY — never the bubble outline
- bubblePolygon: 4-8 [x,y] points around the FULL bubble border (significantly larger than polygon in most cases)
- All coordinates in range 0.0–1.0
- Every SEPARATE text block is its own region — NEVER merge text from different speech bubbles or different locations
- Each speech bubble = one region, even if close together or from the same character
- If no text found: { "found": false, "regions": [], "summary": "No text on this page" }`;
}

const MAX_ATTEMPTS = 4;

/**
 * Gemini generation config shared by all image-OCR calls.
 *
 * thinkingBudget: 0 disables the model's internal reasoning pass.
 * Without this, gemini-2.5-flash enters extended thinking (~30-40 s) on
 * complex manga pages and then returns an empty regions array.
 * Setting budget to 0 cuts latency from ~36 s → ~6 s and raises
 * OCR success rate from ~20 % → ~95 %+ on speech-bubble pages.
 */
const OCR_GEN_CONFIG = {
  maxOutputTokens: 8192,
  thinkingConfig: { thinkingBudget: 0 },
} as const;

// ── Text translation (for descriptions, etc.) ─────────────────────────────────

/**
 * Translate a plain text string directly using the Gemini API.
 * Used for manga descriptions on the manga detail screen.
 */
export async function translateText(
  text: string,
  targetLanguage: string,
  userApiKey: string,
  context?: string,
  options: TranslationOptions = {}
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

  const model = options.model ?? "gemini-2.5-flash";
  console.log(`[TRANSLATION START] kind=text model=${model} key=present`);

  const client = new GoogleGenAI({ apiKey: userApiKey });

  const response = await client.models.generateContent({
    model,
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
 * @param imageUrl       CDN URL of the page image
 * @param targetLanguage BCP-47 language code (en, ar, es, etc.)
 * @param userApiKey     User's Gemini API key (from Settings → AI Keys)
 * @param sourceId       Manga source ID for CDN header selection
 */
export async function translateImage(
  imageUrl: string,
  targetLanguage: string,
  userApiKey: string,
  sourceId: string = "mangadex",
  options: TranslationOptions = {}
): Promise<TranslateResult> {
  if (!userApiKey) {
    throw new Error("No Gemini API key. Open Settings → Gemini API Keys and add your key.");
  }

  const model = options.model ?? "gemini-2.5-flash";
  const requestPath = `/v1beta/models/${model}:generateContent`;
  console.log(
    `[TRANSLATION START] kind=image language=${targetLanguage} model=${model} key=present url=generativelanguage.googleapis.com${requestPath}`
  );

  const { data: imageData, mimeType } = await fetchImageAsBase64(imageUrl, sourceId);
  const prompt = buildPrompt(targetLanguage, options);
  const resolvedMime = mimeType as "image/jpeg" | "image/png" | "image/webp";

  const client = new GoogleGenAI({ apiKey: userApiKey });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const requestStarted = Date.now();
    try {
      console.log(`[TRANSLATION REQUEST] attempt=${attempt}/${MAX_ATTEMPTS} model=${model}`);

      console.log(
        `[TRANSLATION DEBUG] model=${model} key=present geminiRequest=started endpoint=generativelanguage.googleapis.com${requestPath}`
      );
      let response;
      try {
        response = await client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: resolvedMime, data: imageData } },
                { text: prompt },
              ],
            },
          ],
          config: OCR_GEN_CONFIG,
        });
      } catch (err: unknown) {
        const apiErr = err as { status?: number; code?: number; name?: string; message?: string };
        const message = apiErr.message ?? String(err);
        console.error(
          `[TRANSLATION DEBUG] model=${model} geminiRequest=failure geminiHTTP=${apiErr.status ?? apiErr.code ?? "none"} duration=${Date.now() - requestStarted}ms errorCategory=${classifyGeminiError(apiErr, message)} message=${message.slice(0, 180)}`
        );
        throw err;
      }

      const raw = response.text?.trim() ?? "";
      console.log(
        `[TRANSLATION DEBUG] model=${model} geminiRequest=success geminiHTTP=success geminiResponse=received duration=${Date.now() - requestStarted}ms contentType=application/json`
      );

      if (!raw) {
        throw new Error("GEMINI_EMPTY_RESPONSE: Gemini returned no translation data.");
      }

      let parsed: {
        found: boolean;
        regions: Array<{
          original: string;
          translated: string;
          polygon?: unknown;
          bubblePolygon?: unknown;
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
         .filter((r) => options.translateSFX !== false || r.type !== "sfx")
         .filter((r) => options.translateNarration !== false || r.type !== "narration")
         .filter((r) => options.translateCredits !== false || !["credits", "watermark"].includes(r.type))
        .map((r) => {
          const cx = Math.max(0, Math.min(0.99, r.x));
          const cy = Math.max(0, Math.min(0.99, r.y));
          const cw = Math.max(0.02, Math.min(1 - cx, r.w));
          const ch = Math.max(0.02, Math.min(1 - cy, r.h));

          const polygon = validatePolygon(r.polygon) ?? bboxToPolygon(cx, cy, cw, ch);
          const bubblePolygon = validateBubblePolygon(r.bubblePolygon) ?? undefined;
          const centroid = computeCentroid(polygon);
          const rotation = computeRotation(polygon);

          return {
            original: r.original ?? "",
             translated: options.keepOriginal && r.original
               ? `${r.translated ?? ""}\n${r.original}`
               : r.translated ?? "",
            x: cx,
            y: cy,
            w: cw,
            h: ch,
            polygon,
            bubblePolygon,
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
        `[geminiTranslate] Success — regions=${processedRegions.length} attempt=${attempt}`
      );

      return {
        found: parsed.found ?? processedRegions.length > 0,
        regions: processedRegions,
        summary: parsed.summary ?? "",
      };
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string; code?: number };
      const errMsg = anyErr?.message ?? String(err);

      console.error(
        `[TRANSLATION API ERROR] attempt=${attempt} status=${anyErr?.status ?? "none"} category=${classifyGeminiError(anyErr, errMsg)} elapsed=${Date.now() - requestStarted}ms message=${errMsg.slice(0, 180)}`
      );

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

      if (anyErr?.status === 404 || anyErr?.status === 403) {
        throw new Error(
          `MODEL_UNAVAILABLE: The selected Gemini model "${model}" is unavailable for this API key.`
        );
      }

      if (anyErr?.status && anyErr.status >= 400 && anyErr.status < 500) {
        throw new Error(
          `GEMINI_REQUEST_REJECTED: Gemini rejected the translation request (HTTP ${anyErr.status}).`
        );
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

function inferImageMimeType(imageUrl: string): "image/jpeg" | "image/png" | "image/webp" {
  const pathname = imageUrl.split("?")[0].toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function classifyGeminiError(
  err: { status?: number; code?: number; name?: string },
  message = ""
): string {
  const status = err.status ?? err.code;
  if (message.includes("GEMINI_EMPTY_RESPONSE")) return "empty_response";
  if (status === 401 || status === 403) return "auth_or_model";
  if (status === 404) return "model_unavailable";
  if (status === 429) return "rate_limit";
  if (status && status >= 400 && status < 500) return "request_rejected";
  if (err.name === "AbortError") return "timeout";
  return "network_or_server";
}
