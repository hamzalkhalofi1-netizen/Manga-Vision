/**
 * GeminiTextDetection
 *
 * Detection is intentionally separate from translation. Gemini receives the
 * original page and returns stable region IDs, a 0–1000 `box_2d`, and a
 * glyph-tight polygon mask. The server converts those coordinates to the
 * original image's pixel space before any CV work is performed.
 */

import type { GoogleGenAI } from "@google/genai";
import {
  GEMINI_MODEL_CANDIDATES,
  isGeminiModelUnavailable,
} from "@workspace/integrations-gemini-ai";
import sharp from "sharp";

export type Point = [number, number];
export type Box2D = [number, number, number, number];

export interface DetectedTextRegion {
  id: string;
  original: string;
  language: string;
  type: string;
  confidence: number;
  box_2d: Box2D;
  /** Gemini mask, normalized from 0 to 1000 as [x,y] points. */
  mask: Point[];
  /** Normalized [0,1] polygon consumed by the existing renderer/CV API. */
  polygon: Point[];
  /** Pixel-space box on the original image. */
  pixelBox: { x: number; y: number; width: number; height: number };
  /** Pixel-space mask on the original image. */
  pixelMask: Point[];
  maskSource: "gemini" | "box_fallback";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectionResult {
  imageWidth: number;
  imageHeight: number;
  found: boolean;
  regions: DetectedTextRegion[];
  summary: string;
}

interface RawDetectionRegion {
  id?: unknown;
  text?: unknown;
  original?: unknown;
  language?: unknown;
  type?: unknown;
  confidence?: unknown;
  box_2d?: unknown;
  box2d?: unknown;
  mask?: unknown;
  segmentation_mask?: unknown;
  segmentationMask?: unknown;
  polygon?: unknown;
  bubblePolygon?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
}

const DETECTION_PROMPT = `You are a professional manga/manhwa text detection and localization system.

Analyze the supplied ORIGINAL manga page at pixel-level visual precision. Detect
EVERY visible piece of text that could need localization, including English,
Korean, Japanese, Chinese, Arabic, dialogue, speech bubbles, thought bubbles,
narration boxes, captions, signs, UI-like text, small text, vertical text,
stylized fonts, text overlapping artwork, and sound effects when possible.

This is a DETECTION stage, not a translation stage. Do not translate anything.
For every separate text block, return:
- id: a stable sequential ID such as text_001
- text: the text exactly as read (use "" if unreadable)
- language: ISO-like language code or "und"
- type: speech, thought, narration, caption, sign, sfx, title, credits, or watermark
- confidence: number from 0 to 1
- box_2d: [ymin, xmin, ymax, xmax], normalized from 0 to 1000
- mask: a polygon following the visible GLYPH INK only, as [x,y] points
  normalized from 0 to 1000. Do not include speech-bubble borders, tails, or
  unrelated artwork. Use a tight polygon with only a small anti-alias margin.

Use the documented Gemini coordinate convention exactly:
box_2d = [ymin, xmin, ymax, xmax].
Mask points are [x,y]. Do not use CSS, screen, canvas, or display coordinates.
Return one region per separate text block and do not merge different bubbles.
Return ONLY valid JSON, with no markdown or commentary:
{
  "imageWidth": 0,
  "imageHeight": 0,
  "regions": [
    {
      "id": "text_001",
      "text": "original text",
      "language": "en",
      "type": "speech",
      "confidence": 0.98,
      "box_2d": [100, 200, 240, 700],
      "mask": [[240,120],[680,120],[680,220],[240,220]]
    }
  ],
  "summary": "Short detection summary"
}
If no text is visible, return {"imageWidth":0,"imageHeight":0,"regions":[],"summary":"No text on this page"}.`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const source = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw.trim();
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Find the first balanced JSON object without using a greedy regex.
    for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') quoted = true;
        else if (char === "{") depth++;
        else if (char === "}") {
          depth--;
          if (depth === 0) {
            try {
              const parsed: unknown = JSON.parse(source.slice(start, index + 1));
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
}

function normalizeBox(raw: unknown): Box2D | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const values = raw.slice(0, 4).map(numberValue);
  if (values.some((value) => value === null)) return null;
  const [yminRaw, xminRaw, ymaxRaw, xmaxRaw] = values as number[];
  const scale = Math.max(Math.abs(yminRaw), Math.abs(xminRaw), Math.abs(ymaxRaw), Math.abs(xmaxRaw)) <= 1
    ? 1000
    : 1;
  const ymin = clamp(yminRaw * scale, 0, 1000);
  const xmin = clamp(xminRaw * scale, 0, 1000);
  const ymax = clamp(ymaxRaw * scale, 0, 1000);
  const xmax = clamp(xmaxRaw * scale, 0, 1000);
  if (xmax <= xmin || ymax <= ymin) return null;
  return [ymin, xmin, ymax, xmax];
}

function legacyBox(region: RawDetectionRegion): Box2D | null {
  const x = numberValue(region.x);
  const y = numberValue(region.y);
  const w = numberValue(region.w);
  const h = numberValue(region.h);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  const nx = clamp(x, 0, 1);
  const ny = clamp(y, 0, 1);
  const nw = clamp(w, 0, 1 - nx);
  const nh = clamp(h, 0, 1 - ny);
  if (nw <= 0 || nh <= 0) return null;
  return [ny * 1000, nx * 1000, (ny + nh) * 1000, (nx + nw) * 1000];
}

function normalizePolygon(raw: unknown, assumeThousand = false): Point[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 64) return null;
  const points: Point[] = [];
  let scale = assumeThousand ? 1000 : 1;
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const x = numberValue(point[0]);
    const y = numberValue(point[1]);
    if (x === null || y === null) return null;
    if (!assumeThousand && (Math.abs(x) > 1 || Math.abs(y) > 1)) scale = 1000;
  }
  for (const point of raw) {
    const x = numberValue(point[0])!;
    const y = numberValue(point[1])!;
    points.push([clamp(x * scale, 0, scale === 1000 ? 1000 : 1), clamp(y * scale, 0, scale === 1000 ? 1000 : 1)]);
  }
  return points;
}

function boxToNormalizedPolygon(box: Box2D): Point[] {
  const [ymin, xmin, ymax, xmax] = box;
  return [
    [xmin / 1000, ymin / 1000],
    [xmax / 1000, ymin / 1000],
    [xmax / 1000, ymax / 1000],
    [xmin / 1000, ymax / 1000],
  ];
}

function boxToPixel(box: Box2D, width: number, height: number) {
  const [ymin, xmin, ymax, xmax] = box;
  const x = Math.max(0, Math.min(width - 1, Math.round((xmin / 1000) * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round((ymin / 1000) * height)));
  const right = Math.max(x + 1, Math.min(width, Math.round((xmax / 1000) * width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round((ymax / 1000) * height)));
  return { x, y, width: right - x, height: bottom - y };
}

function maskToPixels(mask: Point[], width: number, height: number): Point[] {
  return mask.map(([x, y]) => [
    Math.max(0, Math.min(width - 1, Math.round((x / 1000) * width))),
    Math.max(0, Math.min(height - 1, Math.round((y / 1000) * height))),
  ]);
}

function hasUsableArea(mask: Point[]): boolean {
  if (mask.length < 3) return false;
  let twiceArea = 0;
  let minX = 1000;
  let minY = 1000;
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < mask.length; index++) {
    const [x1, y1] = mask[index];
    const [x2, y2] = mask[(index + 1) % mask.length];
    twiceArea += x1 * y2 - x2 * y1;
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  return Math.abs(twiceArea) >= 1 && maxX - minX >= 1 && maxY - minY >= 1;
}

export function normalizeDetection(
  rawRegions: unknown,
  imageWidth: number,
  imageHeight: number,
): DetectedTextRegion[] {
  if (!Array.isArray(rawRegions)) return [];
  const output: DetectedTextRegion[] = [];

  rawRegions.forEach((rawValue, index) => {
    if (!rawValue || typeof rawValue !== "object") return;
    const raw = rawValue as RawDetectionRegion;
    const box = normalizeBox(raw.box_2d ?? raw.box2d) ?? legacyBox(raw);
    if (!box) return;

    const explicitMask = raw.mask !== undefined ||
      raw.segmentation_mask !== undefined ||
      raw.segmentationMask !== undefined;
    const rawMask = raw.mask ?? raw.segmentation_mask ?? raw.segmentationMask ?? raw.polygon;
    const normalizedMask = normalizePolygon(
      rawMask,
      explicitMask,
    );
    const legacyMaskIsZeroToOne = !explicitMask && normalizedMask
      ? normalizedMask.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)
      : false;
    const candidateMask = normalizedMask
      ? (legacyMaskIsZeroToOne
        ? normalizedMask.map(([x, y]) => [x * 1000, y * 1000] as Point)
        : normalizedMask)
      : null;
    const maskIsUsable = candidateMask !== null && hasUsableArea(candidateMask);
    const mask = maskIsUsable
      ? candidateMask
      : boxToNormalizedPolygon(box).map(([x, y]) => [x * 1000, y * 1000] as Point);
    const normalizedPolygon = mask.map(([x, y]) => [x / 1000, y / 1000] as Point);
    const pixelBox = boxToPixel(box, imageWidth, imageHeight);
    const pixelMask = maskToPixels(mask, imageWidth, imageHeight);
    const original = String(raw.original ?? raw.text ?? "").trim();
    const confidence = clamp(numberValue(raw.confidence) ?? 0.5, 0, 1);

    output.push({
      id: `text_${String(index + 1).padStart(3, "0")}`,
      original,
      language: String(raw.language ?? "und"),
      type: String(raw.type ?? "speech").toLowerCase(),
      confidence,
      box_2d: box,
      mask,
      polygon: normalizedPolygon,
      pixelBox,
      pixelMask,
      maskSource: maskIsUsable ? "gemini" : "box_fallback",
      x: pixelBox.x / imageWidth,
      y: pixelBox.y / imageHeight,
      w: pixelBox.width / imageWidth,
      h: pixelBox.height / imageHeight,
    });
  });

  return output;
}

export async function getImageDimensions(imageBuffer: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(imageBuffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Unable to read manga image dimensions");
  return { width: metadata.width, height: metadata.height };
}

export async function detectTextRegions(
  client: GoogleGenAI,
  imageData: string,
  mimeType: string,
  imageWidth: number,
  imageHeight: number,
): Promise<DetectionResult> {
  let lastError: unknown = null;
  for (const model of GEMINI_MODEL_CANDIDATES) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp", data: imageData } },
              { text: attempt === 1 ? DETECTION_PROMPT : `${DETECTION_PROMPT}\nSECOND PASS: zoom mentally into the entire page and do not omit tiny, vertical, outlined, or partially obscured glyphs.` },
            ],
          }],
          config: {
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        });

        const parsed = parseJsonObject(response.text?.trim() ?? "");
        if (!parsed) throw new Error("Gemini detection returned invalid JSON");
        const regions = normalizeDetection(parsed.regions, imageWidth, imageHeight);
        return {
          imageWidth,
          imageHeight,
          found: regions.length > 0,
          regions,
          summary: typeof parsed.summary === "string" ? parsed.summary : `${regions.length} text region(s) detected`,
        };
      } catch (error) {
        lastError = error;
        if (isGeminiModelUnavailable(error)) break;
        if (attempt === 2) break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini text detection failed");
}