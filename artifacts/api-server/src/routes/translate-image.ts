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
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://mangadex.org/",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchImageAsBase64(
  imageUrl: string
): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(imageUrl, { headers: CDN_HEADERS });
  if (!res.ok)
    throw new Error(`CDN fetch failed with status ${res.status}: ${imageUrl}`);
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

  // ── Resolve image (server-side fetch beats client-side CORS issues) ────────
  let finalData: string;
  let finalMime: string;

  if (imageUrl) {
    try {
      const fetched = await fetchImageAsBase64(imageUrl);
      finalData = fetched.data;
      finalMime = fetched.mimeType;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log?.error({ err }, "Server CDN fetch failed");
      res.status(502).json({ error: `Image fetch failed: ${msg}` });
      return;
    }
  } else {
    finalData = imageData!;
    finalMime = (mimeType?.split(";")[0] ?? "image/jpeg").trim();
  }

  if (finalData.length < 100) {
    res.status(400).json({ error: "Image data is empty or too short" });
    return;
  }

  // ── Pick Gemini client (user key bypasses shared quota) ───────────────────
  const userKey = req.headers["x-gemini-key"] as string | undefined;
  const client = userKey ? createUserGeminiClient(userKey) : ai;

  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const isRTL = targetLanguage === "ar";
  const resolvedMime = finalMime as "image/jpeg" | "image/png" | "image/webp";

  const prompt = `You are a professional manga/manhwa OCR and localization engine.

TASK: Analyze this manga/manhwa page image. For EVERY visible piece of text — speech bubbles, thought bubbles, sound effects, signs, narration boxes, title cards — do ALL of the following:

1. LOCATE using normalized coordinates (0.0–1.0):
   - x: left edge of bubble body (excluding tail)
   - y: top edge of bubble body
   - w: width as fraction of image width
   - h: height as fraction of image height

2. DETECT colors:
   - bgColor: hex of bubble interior (e.g. "#ffffff" white, "#000000" black)
   - textColor: contrasting text color (black on light bubbles, white on dark)

3. TRANSLATE original text to ${langName}:
   - ${isRTL ? "Write natural, energetic Arabic — manga-localized, NOT robotic. Proper MSA with emotional flair." : `Use natural idiomatic ${langName}`}
   - Sound effects: transliterate or use equivalent ${langName} SFX
   - Preserve emphasis, exclamations, ellipsis

Return ONLY valid JSON — no markdown, no backticks, no commentary:
{
  "found": true,
  "regions": [
    {
      "original": "source text",
      "translated": "${langName} translation",
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

Types: "speech" | "thought" | "sfx" | "sign" | "narration" | "title"
If no text found: { "found": false, "regions": [], "summary": "No text on this page" }`;

  // ── Strict sequential call with retry on transient 503 ────────────────────
  const MODEL = "gemini-2.5-flash";
  const MAX_ATTEMPTS = 4;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: resolvedMime, data: finalData } },
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
        parsed = match
          ? (() => {
              try {
                return JSON.parse(match[0]);
              } catch {
                return {
                  found: false,
                  regions: [],
                  summary: "Could not parse AI response",
                };
              }
            })()
          : { found: false, regions: [], summary: "No parseable response" };
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
            emphasis: !!r.emphasis,
            speaker: r.speaker || null,
          }));
      }

      req.log?.info(
        { model: MODEL, attempt, regions: parsed.regions?.length ?? 0 },
        "Image translation success"
      );
      res.json(parsed);
      return;
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string };

      if (anyErr?.status === 429) {
        res.status(429).json({ error: "rate_limited", retryAfter: 70 });
        return;
      }

      if (anyErr?.status === 503 && attempt < MAX_ATTEMPTS) {
        const delay = attempt * 5000;
        req.log?.warn(
          { model: MODEL, attempt, delay },
          `Gemini overloaded, retrying in ${delay}ms`
        );
        await sleep(delay);
        continue;
      }

      const errMsg =
        anyErr?.message ?? (err instanceof Error ? err.message : String(err));
      req.log?.error({ model: MODEL, attempt, err }, "Image translation failed");
      res.status(500).json({
        error: `Translation failed after ${attempt} attempt(s): ${errMsg}`,
      });
      return;
    }
  }
});

export default router;
