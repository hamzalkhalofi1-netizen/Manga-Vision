import { AsyncLocalStorage } from "node:async_hooks";
import { Router } from "express";
import {
  ai,
  createUserGeminiClient,
  GEMINI_MODEL,
  GEMINI_MODEL_UNAVAILABLE_MESSAGE,
  isGeminiModelUnavailable,
} from "@workspace/integrations-gemini-ai";
import {
  detectTextRegions,
  getImageDimensions,
  type DetectedTextRegion,
} from "../cv/GeminiTextDetection.js";

const router = Router();
const requestCtx = new AsyncLocalStorage<{ userKey: string | undefined }>();

interface TranslationOptions {
  style?: "literal" | "natural" | "professional" | "anime" | "custom";
  customStyle?: string;
  translateSFX?: boolean;
  translateNarration?: boolean;
  translateCredits?: boolean;
  keepOriginal?: boolean;
}

interface CachedTranslation {
  found: boolean;
  imageWidth: number;
  imageHeight: number;
  regions: Array<Record<string, unknown>>;
  summary: string;
}

const translationCache = new Map<string, CachedTranslation>();
const CACHE_MAX = 300;
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

const CDN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getCdnReferer(imageUrl: string): string {
  const u = imageUrl.toLowerCase();
  if (u.includes("mangafire") || u.includes("azfast") || u.includes("b-cdn.net/reader")) return "https://mangafire.to/";
  if (u.includes("asura") || u.includes("asuracomic")) return "https://asurascans.com/";
  if (u.includes("bato.to") || u.includes("batocdn") || u.includes("batoto")) return "https://bato.to/";
  if (u.includes("comick") || u.includes("meo.comick")) return "https://comick.io/";
  if (u.includes("mangaplus") || u.includes("shueisha")) return "https://mangaplus.shueisha.co.jp/";
  if (u.includes("webtoon") || u.includes("naver")) return "https://www.webtoons.com/";
  if (u.includes("natomanga") || u.includes("chapmanganato") || u.includes("manganato")) return "https://www.natomanga.com/";
  return "https://mangadex.org/";
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string; buffer: Buffer }> {
  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent": CDN_UA,
      Referer: getCdnReferer(imageUrl),
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`CDN fetch failed with status ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  return {
    buffer,
    mimeType: contentType.split(";")[0].trim(),
    data: buffer.toString("base64"),
  };
}

function cacheKey(imageUrl: string, language: string, options: TranslationOptions): string {
  return `${imageUrl}|${language}|${JSON.stringify(options)}`;
}

function cacheSet(key: string, value: CachedTranslation): void {
  if (translationCache.has(key)) translationCache.delete(key);
  else if (translationCache.size >= CACHE_MAX) translationCache.delete(translationCache.keys().next().value!);
  translationCache.set(key, value);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const source = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw.trim();
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    const start = source.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
      const char = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed: unknown = JSON.parse(source.slice(start, index + 1));
            return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function buildTranslationPrompt(
  targetLanguage: string,
  regions: DetectedTextRegion[],
  options: TranslationOptions,
): string {
  const language = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const style = options.style === "custom"
    ? options.customStyle?.trim() || "natural and idiomatic"
    : options.style === "professional"
      ? "polished and faithful to an official localization"
      : options.style === "literal"
        ? "close to the source wording while remaining grammatical"
        : options.style === "anime"
          ? "emotionally vivid and characterful, like a professional anime localization"
          : "natural and idiomatic";
  const eligible = regions.filter((region) => {
    if (options.translateSFX === false && region.type === "sfx") return false;
    if (options.translateNarration === false && ["narration", "caption"].includes(region.type)) return false;
    if (options.translateCredits === false && ["credits", "watermark"].includes(region.type)) return false;
    return true;
  });

  return `You are the translation stage of a professional manga/manhwa localization pipeline.
Detection has already been completed. Do not change region IDs, coordinates, types, or ordering.
Translate only the supplied source text into ${language}. Use ${style}. Preserve emotional tone,
punctuation, emphasis, sound-effect impact, and natural character voice. For Arabic, write fluent
modern standard Arabic suitable for manga and preserve RTL-friendly wording.

Return ONLY valid JSON:
{"translations":[{"id":"text_001","translated":"..." }]}

Detected regions:
${JSON.stringify(eligible.map((region) => ({
  id: region.id,
  original: region.original,
  language: region.language,
  type: region.type,
})))}`;
}

function parseTranslations(parsed: Record<string, unknown>): Map<string, string> {
  const result = new Map<string, string>();
  const values = Array.isArray(parsed.translations)
    ? parsed.translations
    : Array.isArray(parsed.regions)
      ? parsed.regions
      : [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const translated = typeof row.translated === "string" ? row.translated.trim() : "";
    if (id && translated) result.set(id, translated);
  }
  return result;
}

function outputRegion(region: DetectedTextRegion, translated: string, options: TranslationOptions): Record<string, unknown> {
  return {
    id: region.id,
    original: region.original,
    translated: options.keepOriginal && region.original
      ? `${translated}\n${region.original}`
      : translated,
    language: region.language,
    type: region.type,
    confidence: region.confidence,
    box_2d: region.box_2d,
    mask: region.mask,
    pixelBox: region.pixelBox,
    pixelMask: region.pixelMask,
    maskSource: region.maskSource,
    polygon: region.polygon,
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    bgColor: "#ffffff",
    textColor: "#000000",
    speaker: null,
    emphasis: false,
  };
}

router.post("/", async (req, res) => {
  const userKey = req.headers["x-gemini-key"] as string | undefined;

  await requestCtx.run({ userKey }, async () => {
    const {
      imageData,
      imageUrl,
      mimeType,
      targetLanguage,
      options = {},
    } = req.body as {
      imageData?: string;
      imageUrl?: string;
      mimeType?: string;
      targetLanguage?: string;
      options?: TranslationOptions;
    };

    if (!targetLanguage) {
      res.status(400).json({ error: "targetLanguage is required" });
      return;
    }
    if (!imageData && !imageUrl) {
      res.status(400).json({ error: "Either imageData or imageUrl is required" });
      return;
    }

    const key = imageUrl ? cacheKey(imageUrl, targetLanguage, options) : "";
    if (key && translationCache.has(key)) {
      res.json(translationCache.get(key));
      return;
    }

    let finalData: string;
    let finalMime: string;
    let imageBuffer: Buffer;
    try {
      if (imageData) {
        finalData = imageData;
        finalMime = (mimeType?.split(";")[0] ?? "image/jpeg").trim();
        imageBuffer = Buffer.from(finalData, "base64");
      } else if (imageUrl) {
        const fetched = await fetchImageAsBase64(imageUrl);
        finalData = fetched.data;
        finalMime = fetched.mimeType;
        imageBuffer = fetched.buffer;
      } else {
        throw new Error("No image data supplied");
      }
    } catch (error) {
      res.status(502).json({ error: `Image fetch failed: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    try {
      const { width: imageWidth, height: imageHeight } = await getImageDimensions(imageBuffer);
      const client = requestCtx.getStore()?.userKey
        ? createUserGeminiClient(requestCtx.getStore()!.userKey!)
        : ai;

      // Stage A: dedicated Gemini Vision text detection.
      const detection = await detectTextRegions(client, finalData, finalMime, imageWidth, imageHeight);
      if (detection.regions.length === 0) {
        const empty: CachedTranslation = {
          found: false,
          imageWidth,
          imageHeight,
          regions: [],
          summary: detection.summary || "No text detected on this page",
        };
        if (key) cacheSet(key, empty);
        res.json(empty);
        return;
      }

      // Stage B: translation references the stable detection IDs only.
      const prompt = buildTranslationPrompt(targetLanguage, detection.regions, options);
      let translations = new Map<string, string>();
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await client.models.generateContent({
          model: GEMINI_MODEL,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: finalMime as "image/jpeg" | "image/png" | "image/webp", data: finalData } }, { text: prompt }] }],
          config: { maxOutputTokens: 8192, responseMimeType: "application/json" },
        });
        const parsed = parseJsonObject(response.text?.trim() ?? "");
        if (parsed) translations = parseTranslations(parsed);
        if (translations.size > 0 || attempt === 3) break;
      }

      const outputRegions = detection.regions
        .filter((region) => translations.has(region.id))
        .map((region) => outputRegion(region, translations.get(region.id)!, options));
      const result: CachedTranslation = {
        found: outputRegions.length > 0,
        imageWidth,
        imageHeight,
        regions: outputRegions,
        summary: `${outputRegions.length} region(s) detected and translated`,
      };
      if (key) cacheSet(key, result);
      req.log?.info(
        { imageWidth, imageHeight, detected: detection.regions.length, translated: outputRegions.length },
        "Manga localization detection and translation complete",
      );
      res.json(result);
    } catch (error: unknown) {
      const anyError = error as { status?: number; message?: string };
      if (anyError.status === 429) {
        res.status(429).json({ error: "rate_limited", retryAfter: 70 });
        return;
      }
      if (isGeminiModelUnavailable(error)) {
        req.log?.error({ model: GEMINI_MODEL, status: anyError.status }, "Configured Gemini model unavailable");
        res.status(503).json({
          error: "GEMINI_MODEL_UNAVAILABLE",
          message: GEMINI_MODEL_UNAVAILABLE_MESSAGE,
        });
        return;
      }
      if (anyError.status === 400 && anyError.message?.includes("API_KEY_INVALID")) {
        res.status(401).json({ error: "API_KEY_INVALID: Gemini authentication failed." });
        return;
      }
      req.log?.error({ err: error }, "Manga localization pipeline failed");
      res.status(500).json({ error: `Localization pipeline failed: ${anyError.message ?? String(error)}` });
    }
  });
});

export default router;