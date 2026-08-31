import { Router } from "express";
import { ai, createUserGeminiClient } from "@workspace/integrations-gemini-ai";
import {
  detectTextRegions,
  getImageDimensions,
} from "../cv/GeminiTextDetection.js";

const router = Router();
const CDN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchImage(imageUrl: string): Promise<{ buffer: Buffer; data: string; mimeType: string }> {
  const response = await fetch(imageUrl, {
    headers: {
      "User-Agent": CDN_UA,
      Referer: "https://mangadex.org/",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`Image fetch failed with status ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    data: buffer.toString("base64"),
    mimeType: (response.headers.get("content-type") ?? "image/jpeg").split(";")[0],
  };
}

router.post("/", async (req, res) => {
  const { imageData, imageUrl, mimeType } = req.body as {
    imageData?: string;
    imageUrl?: string;
    mimeType?: string;
  };
  if (!imageData && !imageUrl) {
    res.status(400).json({ error: "Either imageData or imageUrl is required" });
    return;
  }

  try {
    const image = imageData
      ? {
          buffer: Buffer.from(imageData, "base64"),
          data: imageData,
          mimeType: (mimeType?.split(";")[0] ?? "image/jpeg").trim(),
        }
      : await fetchImage(imageUrl!);
    const { width, height } = await getImageDimensions(image.buffer);
    const userKey = req.headers["x-gemini-key"];
    const client = typeof userKey === "string" && userKey.trim()
      ? createUserGeminiClient(userKey)
      : ai;
    const detection = await detectTextRegions(client, image.data, image.mimeType, width, height);
    res.json(detection);
  } catch (error) {
    req.log?.error({ err: error }, "Text detection failed");
    res.status(500).json({
      error: `Text detection failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

export default router;