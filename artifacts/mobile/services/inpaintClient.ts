import type { TextRegion } from "@/components/MangaPage";

interface HFTextBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
}

interface HFTranslatedBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  original: string;
  translated: string;
}

interface HFResponse {
  canvas_b64: string;
  translated_blocks: HFTranslatedBlock[];
}

async function imageUrlToBase64(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function mapToTextRegions(blocks: HFTranslatedBlock[]): TextRegion[] {
  return blocks
    .filter((b) => b.translated && b.translated.trim().length > 0)
    .map((b) => ({
      original: b.original,
      translated: b.translated,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      type: "dialogue",
      bgColor: "#FFFFFF",
      textColor: "#000000",
      speaker: null,
      emphasis: false,
    }));
}

export interface InpaintResult {
  regions: TextRegion[];
  canvas_b64: string;
  summary: string;
}

export interface ImageProcessingOptions {
  removalMode?: "inpaint" | "overlay";
  maskPadding?: number;
  preserveBubbleBorders?: boolean;
}

export async function callInpaintServer(
  serverUrl: string,
  imageUrl: string,
  textBlocks: HFTextBlock[] = [],
  timeoutMs = 90_000,
): Promise<InpaintResult> {
  const image_b64 = await imageUrlToBase64(imageUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/inpaint_and_translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64, text_blocks: textBlocks }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = `${detail}: ${body.detail}`;
    } catch {}
    throw new Error(detail);
  }

  const data: HFResponse = await res.json();
  const regions = mapToTextRegions(data.translated_blocks ?? []);

  return {
    regions,
    canvas_b64: data.canvas_b64 ?? "",
    summary: `${regions.length} region${regions.length !== 1 ? "s" : ""} translated via inpaint server`,
  };
}
