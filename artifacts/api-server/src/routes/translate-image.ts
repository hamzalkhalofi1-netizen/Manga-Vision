import { Router } from "express";
import { ai } from "@workspace/integrations-gemini-ai";

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

router.post("/", async (req, res) => {
  const { imageData, mimeType, targetLanguage } = req.body as {
    imageData?: string;
    mimeType?: string;
    targetLanguage?: string;
  };

  if (!imageData || !targetLanguage) {
    res.status(400).json({ error: "imageData and targetLanguage are required" });
    return;
  }

  if (!imageData || imageData.length < 100) {
    res.status(400).json({ error: "imageData is empty or too short" });
    return;
  }

  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  const isRTL = targetLanguage === "ar";
  const resolvedMime = (mimeType?.split(";")[0] ?? "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/webp";

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
  } catch (err) {
    req.log?.error({ err }, "Image translation failed");
    res.status(500).json({ error: "Translation service unavailable" });
  }
});

export default router;
