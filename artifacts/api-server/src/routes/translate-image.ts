import { Router } from "express";
import { ai, createUserGeminiClient } from "@workspace/integrations-gemini-ai";

const router = Router();

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

const CDN_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://mangadex.org/",
  "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

const VISION_MODEL = "gemini-2.5-flash";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(imageUrl, { headers: CDN_HEADERS });
  if (!res.ok) throw new Error(`CDN fetch failed: ${res.status} ${imageUrl}`);
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const mimeType = contentType.split(";")[0].trim();
  const data = Buffer.from(buf).toString("base64");
  return { data, mimeType };
}

router.post("/", async (req, res) => {
  const { imageData, imageUrl, mimeType, targetLanguage } = req.body as {
    imageData?: string;
    imageUrl?: string;
    mimeType?: string;
    targetLanguage?: string;
  };

  if (!targetLanguage) {
    res.status(400).json({ error: "targetLanguage is required" });
    return;
  }
  if (!imageData && !imageUrl) {
    res.status(400).json({ error: "Either imageData or imageUrl is required" });
    return;
  }

  // ── Resolve image data ────────────────────────────────────────────────────
  let finalImageData: string;
  let finalMimeType: string;

  if (imageUrl) {
    try {
      const fetched = await fetchImageAsBase64(imageUrl);
      finalImageData = fetched.data;
      finalMimeType = fetched.mimeType;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log?.error({ err }, `Server-side image fetch failed: ${msg}`);
      res.status(502).json({ error: `Could not fetch image: ${msg}` });
      return;
    }
  } else {
    finalImageData = imageData!;
    finalMimeType = (mimeType?.split(";")[0] ?? "image/jpeg").trim();
  }

  if (!finalImageData || finalImageData.length < 100) {
    res.status(400).json({ error: "imageData is empty or too short" });
    return;
  }

  // ── Select Gemini client ──────────────────────────────────────────────────
  const userKey = req.headers["x-gemini-key"] as string | undefined;
  const client = userKey ? createUserGeminiClient(userKey) : ai;

  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const isRTL = targetLanguage === "ar";
  const resolvedMime = (finalMimeType as "image/jpeg" | "image/png" | "image/webp") ?? "image/jpeg";

  const prompt = `You are a professional manga/manhwa OCR and localization engine.

TASK: Analyze this manga/manhwa page. For EVERY piece of text (speech bubbles, thought bubbles, sound effects, signs, narration boxes, title cards) do the following:

1. LOCATE the text using normalized coordinates:
   - x: left edge of the text container (0.0 = image left, 1.0 = image right)
   - y: top edge of the text container (0.0 = image top, 1.0 = image bottom)
   - w: width of the text container (fraction of image width)
   - h: height of the text container (fraction of image height)
   - IMPORTANT: estimate the bubble BODY area (excluding the tail/pointer), where text actually sits
   - Be precise — use visual cues like panel borders and character positions

2. DETECT bubble background:
   - bgColor: hex color of the bubble interior (e.g. "#ffffff" for white, "#000000" for dark bubbles)
   - textColor: hex color the translated text should be (black on white bubbles, white on dark bubbles)

3. TRANSLATE the original text to ${langName}:
   - Preserve emotional intensity, character personality, humor, drama
   - ${isRTL ? "Arabic text must be natural, energetic, manga-localized — NOT robotic. Use proper MSA with emotional flair." : "Use natural idiomatic " + langName}
   - Sound effects (SFX): transliterate phonetically OR use equivalent ${langName} SFX
   - Keep exclamations, ellipsis, emphasis

Return ONLY this valid JSON (absolutely no markdown, no backticks, no extra text):
{
  "found": true,
  "regions": [
    {
      "original": "original text",
      "translated": "${langName} translation",
      "x": 0.05,
      "y": 0.03,
      "w": 0.42,
      "h": 0.11,
      "type": "speech",
      "bgColor": "#ffffff",
      "textColor": "#000000",
      "speaker": "character name or null",
      "emphasis": false
    }
  ],
  "summary": "1-2 sentence description of what's happening on this page"
}

Type values: "speech" | "thought" | "sfx" | "sign" | "narration" | "title"

If NO text found: { "found": false, "regions": [], "summary": "No text on this page" }`;

  // ── Try each model in order, fallback on 503 overload ────────────────────
  let lastErr: unknown;

  for (const model of VISION_MODELS) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: resolvedMime, data: finalImageData } },
              { text: prompt },
            ],
          },
        ],
        config: { maxOutputTokens: 8192 },
      });

      const raw = response.text?.trim() ?? "";

      let parsed: {
        found: boolean;
        regions: Array<{
          original: string;
          translated: string;
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
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            parsed = { found: false, regions: [], summary: "Could not parse AI response" };
          }
        } else {
          parsed = { found: false, regions: [], summary: "No parseable response from AI" };
        }
      }

      if (parsed.regions) {
        parsed.regions = parsed.regions
          .filter((r) => r && typeof r.x === "number" && typeof r.y === "number")
          .map((r) => ({
            ...r,
            x: Math.max(0, Math.min(0.99, r.x)),
            y: Math.max(0, Math.min(0.99, r.y)),
            w: Math.max(0.02, Math.min(1 - r.x, r.w)),
            h: Math.max(0.02, Math.min(1 - r.y, r.h)),
            bgColor: r.bgColor || "#ffffff",
            textColor: r.textColor || "#000000",
            emphasis: r.emphasis || false,
            speaker: r.speaker || null,
          }));
      }

      res.json(parsed);
      return;
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string };

      if (anyErr?.status === 429) {
        res.status(429).json({ error: "rate_limited", retryAfter: 70 });
        return;
      }

      // 503 overload — retry same model up to MAX_503_RETRIES, then try next
      if (anyErr?.status === 503) {
        req.log?.warn({ model, err }, `Model ${model} overloaded, trying next`);
        lastErr = err;
        continue; // try next model in list
      }

      req.log?.error({ model, err }, "Image translation failed");
      res.status(500).json({ error: "Translation service unavailable" });
      return;
    }
  }

  // All models exhausted
  req.log?.error({ lastErr }, "All vision models unavailable");
  res.status(503).json({ error: "Gemini vision service is temporarily overloaded. Please retry in a moment." });
});

export default router;
