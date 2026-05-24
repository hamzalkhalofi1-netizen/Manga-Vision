import { AsyncLocalStorage } from "node:async_hooks";
import { Router } from "express";
import { ai, createUserGeminiClient } from "@workspace/integrations-gemini-ai";

const router = Router();

const requestCtx = new AsyncLocalStorage<{ userKey: string | undefined }>();

// ── Server-side page translation cache ────────────────────────────────────────
//
// Keyed by `imageUrl|targetLanguage`.  Survives within the server process
// lifetime — prevents duplicate Gemini calls when the same page is requested
// multiple times (e.g. chapter re-open, retry after network error).
//
// Max 300 entries with simple FIFO eviction (insertion order via Map).

interface CachedTranslation {
  found: boolean;
  regions: unknown[];
  summary: string;
}

const translationCache = new Map<string, CachedTranslation>();
const CACHE_MAX = 300;

function cacheGet(imageUrl: string, lang: string): CachedTranslation | undefined {
  return translationCache.get(`${imageUrl}|${lang}`);
}

function cacheSet(imageUrl: string, lang: string, value: CachedTranslation): void {
  const key = `${imageUrl}|${lang}`;
  if (translationCache.has(key)) {
    // Refresh position by re-inserting
    translationCache.delete(key);
  } else if (translationCache.size >= CACHE_MAX) {
    // Evict oldest entry
    translationCache.delete(translationCache.keys().next().value!);
  }
  translationCache.set(key, value);
}

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

/**
 * Derive a 4-point polygon from a bounding box when Gemini doesn't supply one.
 * Order: top-left, top-right, bottom-right, bottom-left (clockwise).
 */
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

/**
 * Validate that a polygon is a non-degenerate array of [x, y] pairs within [0,1].
 */
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
  // Pad or trim to exactly 4 points
  while (valid.length < 4) valid.push(valid[valid.length - 1]);
  return [valid[0], valid[1], valid[2], valid[3]];
}

router.post("/", async (req, res) => {
  const userKey = req.headers["x-gemini-key"] as string | undefined;

  await requestCtx.run({ userKey }, async () => {
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

    // ── Cache check (imageUrl path only — base64 uploads are not cached) ──────
    if (imageUrl) {
      const hit = cacheGet(imageUrl, targetLanguage);
      if (hit) {
        req.log?.info(
          { imageUrl, targetLanguage, regions: hit.regions.length },
          "Translation cache hit — skipping Gemini call"
        );
        res.json(hit);
        return;
      }
    }

    const ctx = requestCtx.getStore()!;
    const client = ctx.userKey ? createUserGeminiClient(ctx.userKey) : ai;

    const langName = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
    const isRTL = targetLanguage === "ar";
    const resolvedMime = finalMime as "image/jpeg" | "image/png" | "image/webp";

    const prompt = `You are a professional manga/manhwa OCR and translation engine.

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

        if (parsed.regions) {
          parsed.regions = parsed.regions
            .filter((r) => r && typeof r.x === "number" && typeof r.y === "number")
            .map((r) => {
              const cx = Math.max(0, Math.min(0.99, r.x));
              const cy = Math.max(0, Math.min(0.99, r.y));
              const cw = Math.max(0.02, Math.min(1 - cx, r.w));
              const ch = Math.max(0.02, Math.min(1 - cy, r.h));

              // Validate or derive polygon
              const polygon =
                validatePolygon(r.polygon) ?? bboxToPolygon(cx, cy, cw, ch);

              return {
                ...r,
                x: cx,
                y: cy,
                w: cw,
                h: ch,
                polygon,
                centerX: cx + cw / 2,
                centerY: cy + ch / 2,
                bgColor: r.bgColor || "#ffffff",
                textColor: r.textColor || "#000000",
                emphasis: !!r.emphasis,
                speaker: r.speaker || null,
                translated: r.translated ?? "",
              };
            });
        }

        req.log?.info(
          { model: MODEL, attempt, regions: parsed.regions?.length ?? 0 },
          "Image translation success"
        );

        // Store in server cache — future requests for this page skip Gemini entirely
        if (imageUrl) {
          cacheSet(imageUrl, targetLanguage, parsed);
        }

        res.json(parsed);
        return;
      } catch (err: unknown) {
        const anyErr = err as { status?: number; message?: string };

        if (anyErr?.status === 400 && anyErr?.message?.includes("API_KEY_INVALID")) {
          req.log?.error({ model: MODEL, attempt }, "API_KEY_INVALID: aborting");
          res.status(401).json({
            error:
              "API_KEY_INVALID: Your Gemini API key is not valid or has been revoked. " +
              "Open Settings → AI Keys and add a working key, then try again.",
          });
          return;
        }

        if (anyErr?.status === 429) {
          res.status(429).json({ error: "rate_limited", retryAfter: 70 });
          return;
        }

        if (anyErr?.status === 503 && attempt < MAX_ATTEMPTS) {
          const delay = attempt * 5000;
          req.log?.warn({ model: MODEL, attempt, delay }, `Gemini overloaded, retrying in ${delay}ms`);
          await sleep(delay);
          continue;
        }

        const errMsg = anyErr?.message ?? (err instanceof Error ? err.message : String(err));
        req.log?.error({ model: MODEL, attempt, err }, "Image translation failed");
        res.status(500).json({
          error: `Translation failed after ${attempt} attempt(s): ${errMsg}`,
        });
        return;
      }
    }
  });
});

export default router;
