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
import { getApiBase } from "./api";
import type { GeminiModel } from "./geminiKeyTest";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TranslatedRegion {
  original: string;
  translated: string;
  /** Tight 4-point polygon wrapping the text glyphs (normalized 0–1). */
  polygon?: [number, number][];
  /** Gemini's glyph mask, normalized from 0 to 1000 as [x,y] points. */
  mask?: [number, number][];
  /** Gemini's documented [ymin,xmin,ymax,xmax] box, normalized 0–1000. */
  box_2d?: [number, number, number, number];
  id?: string;
  language?: string;
  confidence?: number;
  maskSource?: "gemini" | "box_fallback";
  pixelBox?: { x: number; y: number; width: number; height: number };
  pixelMask?: [number, number][];
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
  sourceId: string,
  localImageUri?: string,
): Promise<{ data: string; mimeType: string }> {
  const headers = getBasicImageHeaders(sourceId);
  const startedAt = Date.now();

  // Native reader pages are already downloaded by ImageDiskCache. Reuse those
  // exact bytes instead of issuing a second JS fetch to the CDN. This matters
  // on Android: the reader's native FileSystem request can succeed even when a
  // JavaScript fetch to the same hotlink-protected URL fails with "Failed to
  // fetch".
  if (Platform.OS !== "web") {
    let localUri = localImageUri;
    try {
      if (!localUri) {
        localUri = (await ImageDiskCache.getPath(imageUrl)) ?? undefined;
      }
      if (!localUri) {
        throw new Error(
          "IMAGE_CACHE_READ_FAILED: Reader image is not available in the local cache",
        );
      }
      const info = await FileSystem.getInfoAsync(localUri, {
        size: true,
      } as any);
      const sizeBytes =
        (info as FileSystem.FileInfo & { size?: number }).size ?? 0;
      if (!info.exists || sizeBytes === 0) {
        throw new Error(
          "IMAGE_CACHE_READ_FAILED: Cached image is missing or empty",
        );
      }

      let data: string;
      try {
        data = await FileSystem.readAsStringAsync(localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch (readErr) {
        const message =
          readErr instanceof Error ? readErr.message : String(readErr);
        throw new Error(`IMAGE_CACHE_READ_FAILED: ${message}`);
      }
      if (!data)
        throw new Error(
          "IMAGE_CONVERSION_FAILED: FileSystem returned empty base64",
        );

      const mimeType = inferImageMimeType(localUri || imageUrl);
      console.log(
        `[TRANSLATION DEBUG] source=${sourceId} imageSource=${localImageUri ? "LOCAL_CACHE" : "NETWORK"} ` +
          `imageExists=true imageSize=${sizeBytes} imageConversion=SUCCESS base64Length=${data.length} ` +
          `duration=${Date.now() - startedAt}ms`,
      );
      return { data, mimeType };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[TRANSLATION DEBUG] source=${sourceId} imageSource=${localImageUri ? "LOCAL_CACHE" : "NETWORK"} ` +
          `imageExists=unknown imageConversion=FAIL duration=${Date.now() - startedAt}ms message=${message.slice(0, 180)}`,
      );
      throw new Error(
        message.startsWith("IMAGE_")
          ? message
          : `IMAGE_DOWNLOAD_FAILED: ${message.slice(0, 180)}`,
      );
    }
  }

  // MangaPage already uses this existing proxy rewrite on web. Reuse it here
  // so the translation request sees the same CORS/hotlink-safe image URL as
  // the reader; native keeps the original URL and headers.
  // MangaPage already resolved the exact URI it rendered (the source proxy URL
  // on web). Reuse it instead of rebuilding a second request from the CDN URL.
  const requestUrl =
    localImageUri ?? ImageLoader.maybeProxyUrl(imageUrl);
  const requestHost = (() => {
    try {
      return new URL(requestUrl).host;
    } catch {
      return "invalid-url";
    }
  })();

  console.log(
    `[TRANSLATION DEBUG] source=${sourceId} imageSource=PROXY imageFetch=started host=${requestHost} proxied=${requestUrl !== imageUrl}`,
  );

  let response: Response;
  const webFetchStartedAt = Date.now();
  try {
    // The web request goes through the same-origin source proxy. The proxy
    // adds the source Referer/User-Agent server-side; sending those
    // browser-forbidden headers here can make Fetch reject with only
    // "Failed to fetch" before the request reaches the proxy.
    response = await fetch(requestUrl);
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[TRANSLATION DEBUG] source=${sourceId} imageSource=PROXY imageFetch=failure duration=${Date.now() - webFetchStartedAt}ms ` +
        `errorCategory=${name === "AbortError" ? "TIMEOUT" : "IMAGE_DOWNLOAD_FAILED"} message=${message.slice(0, 160)}`,
    );
    throw new Error(
      name === "AbortError"
        ? "TIMEOUT: The manga image request timed out."
        : `IMAGE_DOWNLOAD_FAILED: Could not load the manga image (${message.slice(0, 160)}).`,
    );
  }

  if (!response.ok) {
    console.error(
      `[TRANSLATION DEBUG] source=${sourceId} imageSource=PROXY imageFetch=failure status=${response.status} ` +
        `contentType=${response.headers.get("content-type") ?? "unknown"} duration=${Date.now() - webFetchStartedAt}ms ` +
        `errorCategory=IMAGE_DOWNLOAD_FAILED`,
    );
    throw new Error(
      `IMAGE_DOWNLOAD_FAILED: Manga image request returned HTTP ${response.status}.`,
    );
  }

  const blob = await response.blob();
  const mimeType = (blob.type || "image/jpeg").split(";")[0].trim();

  console.log(
    `[TRANSLATION DEBUG] source=${sourceId} imageSource=PROXY imageFetch=success imageBytes=${blob.size} ` +
      `contentType=${mimeType} duration=${Date.now() - webFetchStartedAt}ms`,
  );

  return new Promise<{ data: string; mimeType: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(
          new Error(
            "IMAGE_CONVERSION_FAILED: FileReader produced empty base64",
          ),
        );
        return;
      }
      resolve({ data: base64, mimeType });
    };
    reader.onerror = () =>
      reject(
        new Error(
          "IMAGE_CONVERSION_FAILED: FileReader error reading image blob",
        ),
      );
    reader.readAsDataURL(blob);
  });
}

// ── Polygon geometry helpers ───────────────────────────────────────────────────

function computeCentroid(poly: [number, number][]): { x: number; y: number } {
  const n = poly.length;
  let cx = 0,
    cy = 0,
    area = 0;
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
  h: number,
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

function validatePolygon(
  raw: unknown,
):
  | [[number, number], [number, number], [number, number], [number, number]]
  | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const pts = raw.map((p) => {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (isNaN(x) || isNaN(y)) return null;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] as [
      number,
      number,
    ];
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

function parseGeminiJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced || raw.trim();

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {}

  // Gemini may add a short explanation around the JSON. Extract balanced
  // objects instead of using a greedy regex that can include later braces.
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(source.slice(start, i + 1));
            return parsed && typeof parsed === "object"
              ? (parsed as Record<string, unknown>)
              : null;
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

// ── Gemini prompt ──────────────────────────────────────────────────────────────

export interface TranslationOptions {
  model?: GeminiModel;
  /** Exact local file currently rendered by MangaPage on native. */
  localImageUri?: string;
  style?: "literal" | "natural" | "professional" | "anime" | "custom";
  customStyle?: string;
  translateSFX?: boolean;
  translateNarration?: boolean;
  translateCredits?: boolean;
  keepOriginal?: boolean;
}

function buildPrompt(
  targetLanguage: string,
  options: TranslationOptions = {},
): string {
  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const isRTL = targetLanguage === "ar";
  const styleInstruction =
    options.style === "custom"
      ? options.customStyle?.trim() || "natural and idiomatic"
      : options.style === "literal"
        ? "close to the source wording while remaining grammatical"
        : options.style === "professional"
          ? "polished and faithful to an official localization"
          : options.style === "anime"
            ? "emotionally vivid, characterful, and consistent with anime localization"
            : "natural and idiomatic";
  const typeInstruction = [
    options.translateSFX === false
      ? "Do not translate sound effects; omit SFX regions."
      : "",
    options.translateNarration === false
      ? "Do not translate narration boxes; omit narration regions."
      : "",
    options.translateCredits === false
      ? "Do not translate credits or metadata; omit credits regions."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

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
   ${
     isRTL
       ? "- Natural, emotionally vivid Arabic — manga-localized, NOT robotic. Proper MSA with character voice and emotional flair.\n   - Sound effects: Arabic SFX equivalents or creative transliteration\n   - Preserve exclamations, ellipses, emphasis"
       : `- ${styleInstruction} ${langName} — emotionally faithful\n   - Sound effects: equivalent ${langName} SFX or transliteration\n   - Preserve exclamations, ellipses, emphasis`
   }

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
 * Flash-Lite does not need a thinking configuration. Keeping this config
 * limited to output size also avoids INVALID_ARGUMENT responses from the
 * latest-model alias.
 */
const OCR_GEN_CONFIG = {
  maxOutputTokens: 8192,
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
  options: TranslationOptions = {},
): Promise<string> {
  if (!userApiKey) {
    throw new Error(
      "No Gemini API key. Open Settings → Gemini API Keys and add your key.",
    );
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

  const model = options.model ?? "gemini-flash-lite-latest";
  console.log(`[TRANSLATION START] kind=text model=${model} key=present`);

  const client = new GoogleGenAI({ apiKey: userApiKey });

  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 8192 },
  });

  const result = response.text?.trim() ?? "";
  if (!result) throw new Error("Translation returned empty result");

  console.log(
    `[geminiTranslate] translateText success — ${result.length} chars`,
  );
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
  options: TranslationOptions = {},
): Promise<TranslateResult> {
  if (!userApiKey) {
    throw new Error(
      "No Gemini API key. Open Settings → Gemini API Keys and add your key.",
    );
  }

  // Manga page localization runs through the server-side detection pipeline.
  // This keeps Gemini out of the client bundle for image OCR and ensures the
  // returned regions contain the same validated mask used by OpenCV cleanup.
  const { data: imageData, mimeType } = await fetchImageAsBase64(
    imageUrl,
    sourceId,
    options.localImageUri,
  );
  const apiRoot = Platform.OS === "web"
    ? "/api"
    : `${getApiBase()}`.replace(/\/$/, "") + "/api";
  if (Platform.OS !== "web" && !getApiBase()) {
    throw new Error("API_SERVER_NOT_CONFIGURED: Configure the API Server URL in Settings.");
  }

  const response = await fetch(`${apiRoot}/translate-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-gemini-key": userApiKey,
    },
    body: JSON.stringify({
      imageUrl,
      imageData,
      mimeType,
      targetLanguage,
      options: {
        style: options.style,
        customStyle: options.customStyle,
        translateSFX: options.translateSFX,
        translateNarration: options.translateNarration,
        translateCredits: options.translateCredits,
        keepOriginal: options.keepOriginal,
      },
    }),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json() as { error?: string };
      if (errorBody.error === "GEMINI_MODEL_UNAVAILABLE") {
        detail = "GEMINI_MODEL_UNAVAILABLE: Gemini model unavailable. Check the configured Gemini model and API project.";
      } else if (errorBody.error) {
        detail = errorBody.error;
      }
    } catch {}
    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (response.status === 401) throw new Error("GEMINI_AUTH_FAILED: Your Gemini API key is not valid or has been revoked.");
    throw new Error(`GEMINI_REQUEST_FAILED: ${detail}`);
  }

  const result = await response.json() as {
    found?: boolean;
    regions?: TranslatedRegion[];
    summary?: string;
  };
  return {
    found: result.found ?? (result.regions?.length ?? 0) > 0,
    regions: result.regions ?? [],
    summary: result.summary ?? "",
  };
}

function inferImageMimeType(
  imageUrl: string,
): "image/jpeg" | "image/png" | "image/webp" {
  const pathname = imageUrl.split("?")[0].toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function classifyGeminiError(
  err: { status?: number; code?: number; name?: string },
  message = "",
): string {
  const status = err.status ?? err.code;
  if (message.includes("GEMINI_EMPTY_RESPONSE")) return "GEMINI_EMPTY_RESPONSE";
  if (
    message.includes("API_KEY_INVALID") ||
    message.includes("API key not valid") ||
    status === 401
  ) {
    return "GEMINI_AUTH_FAILED";
  }
  if (status === 403 || status === 404) return "GEMINI_MODEL_FAILED";
  if (status === 429) return "GEMINI_REQUEST_FAILED";
  if (status && status >= 400 && status < 500) return "GEMINI_REQUEST_FAILED";
  if (err.name === "AbortError" || message.toLowerCase().includes("timeout"))
    return "TIMEOUT";
  return "GEMINI_REQUEST_FAILED";
}
