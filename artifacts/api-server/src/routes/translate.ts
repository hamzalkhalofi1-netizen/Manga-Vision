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
};

router.post("/", async (req, res) => {
  const { text, targetLanguage, context } = req.body as {
    text?: string;
    targetLanguage?: string;
    context?: string;
  };

  if (!text || !targetLanguage) {
    res.status(400).json({ error: "text and targetLanguage are required" });
    return;
  }

  if (text.trim().length === 0) {
    res.status(400).json({ error: "text cannot be empty" });
    return;
  }

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

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 8192 },
    });

    const translatedText = response.text?.trim() ?? "";

    if (!translatedText) {
      res.status(500).json({ error: "Translation returned empty result" });
      return;
    }

    res.json({
      translatedText,
      sourceLanguage: "auto",
    });
  } catch (err) {
    req.log?.error({ err }, "Translation failed");
    res.status(500).json({ error: "Translation service unavailable" });
  }
});

export default router;
