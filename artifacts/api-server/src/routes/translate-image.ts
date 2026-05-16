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
  const { imageUrl, targetLanguage } = req.body as {
    imageUrl?: string;
    targetLanguage?: string;
  };

  if (!imageUrl || !targetLanguage) {
    res.status(400).json({ error: "imageUrl and targetLanguage are required" });
    return;
  }

  const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

  try {
    let imageData: string;
    let mimeType: string;

    const upstream = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MangaVerse/1.0)",
        "Referer": "https://mangadex.org/",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `Failed to fetch image: ${upstream.status}` });
      return;
    }

    const buffer = await upstream.arrayBuffer();
    imageData = Buffer.from(buffer).toString("base64");
    mimeType = upstream.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";

    const prompt = `You are an expert manga/manhwa/webtoon text extractor and localizer.

Analyze this manga/manhwa page image and find ALL text in:
- Speech bubbles (round or square)
- Thought bubbles
- Narrative text boxes
- Signs, labels, and titles
- Sound effects (onomatopoeia)

For each piece of text found, translate it to ${langName}.

Return a JSON object with this exact structure:
{
  "found": true,
  "texts": [
    {
      "original": "the original text as it appears",
      "translated": "the ${langName} translation",
      "type": "speech|thought|narration|sfx|sign",
      "speaker": "character name if identifiable or null"
    }
  ],
  "summary": "1-2 sentence plot summary of what's happening in this page"
}

If no text is found, return: { "found": false, "texts": [], "summary": "No text detected in this page" }

Translation rules:
- Preserve emotional tone, character personality and dramatic impact
- Use natural, idiomatic ${langName} — never robotic
- For Arabic: use right-to-left text naturally with proper diacritics
- Preserve exclamations and sound effect energy
- Keep honorifics where culturally appropriate

Return ONLY valid JSON, no markdown code blocks, no extra text.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp",
                data: imageData,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: { maxOutputTokens: 4096 },
    });

    const raw = response.text?.trim() ?? "";
    let parsed: {
      found: boolean;
      texts: Array<{ original: string; translated: string; type: string; speaker: string | null }>;
      summary: string;
    };

    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        parsed = { found: false, texts: [], summary: "Could not parse translation results" };
      }
    }

    res.json(parsed);
  } catch (err) {
    req.log?.error({ err }, "Image translation failed");
    res.status(500).json({ error: "Translation service unavailable" });
  }
});

export default router;
