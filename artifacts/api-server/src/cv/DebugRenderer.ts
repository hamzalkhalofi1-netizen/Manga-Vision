/**
 * DebugRenderer
 *
 * Produces OpenCV-annotated images for every stage of the CV pipeline.
 * Used exclusively by the /api/debug-pipeline diagnostic endpoint.
 *
 * Color legend (BGR → visual):
 *   speech_bubble  → Green    (0, 255, 0)
 *   narration_box  → Blue     (200, 80, 0)
 *   sfx            → Orange   (0, 140, 255)
 *   ui_text        → Cyan     (255, 200, 0)
 *   chapter_title  → Red      (0, 0, 200)
 *   credits        → Purple   (140, 0, 140)
 *   watermark      → Magenta  (200, 0, 200)
 *   unknown        → Gray     (150, 150, 150)
 */

import sharp from "sharp";
import { getCV } from "./index.js";

// ── Color tables (OpenCV BGR order) ───────────────────────────────────────────

export const CLASS_BGR: Record<string, readonly [number, number, number]> = {
  speech_bubble: [0,   255,   0],
  narration_box: [200,  80,   0],
  sfx:           [  0, 140, 255],
  ui_text:       [255, 200,   0],
  chapter_title: [  0,   0, 200],
  credits:       [140,   0, 140],
  watermark:     [200,   0, 200],
  unknown:       [150, 150, 150],
};

const TYPE_BGR: Record<string, readonly [number, number, number]> = {
  speech:    [  0, 220,   0],
  thought:   [ 80, 200,   0],
  narration: [200,  80,   0],
  sfx:       [  0, 140, 255],
  sign:      [255, 180,   0],
  title:     [  0,   0, 200],
  credits:   [140,   0, 140],
  watermark: [200,   0, 200],
};

const WHITE: readonly [number, number, number] = [255, 255, 255];
const YELLOW: readonly [number, number, number] = [0, 220, 255];
const GRAY:   readonly [number, number, number] = [150, 150, 150];

type Bgr = readonly [number, number, number];

// ── Mat helpers ───────────────────────────────────────────────────────────────

export async function toBGR(imgBuf: Buffer): Promise<{ mat: any; w: number; h: number }> {
  const cv = getCV();
  const { data, info } = await sharp(imgBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const rgbaMat = new cv.Mat(h, w, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(data.buffer, data.byteOffset, data.length));
  const bgrMat = new cv.Mat();
  cv.cvtColor(rgbaMat, bgrMat, cv.COLOR_RGBA2BGR);
  rgbaMat.delete();
  return { mat: bgrMat, w, h };
}

export async function toPNG(bgrMat: any, w: number, h: number): Promise<Buffer> {
  const cv = getCV();
  const rgbMat = new cv.Mat();
  cv.cvtColor(bgrMat, rgbMat, cv.COLOR_BGR2RGB);
  // SAFE copy: Buffer.from(typedArray) copies data before the WASM Mat is
  // deleted.  Buffer.from(mat.data.buffer, byteOffset, length) would create
  // a view into WASM heap that becomes invalid after mat.delete(), producing
  // the tiling artifact seen in diagnostic stage images.
  const raw = Buffer.from(rgbMat.data);
  rgbMat.delete();
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 3 })
    .toBuffer();
}

// ── Drawing primitives ────────────────────────────────────────────────────────

function sc(bgr: Bgr) {
  const cv = getCV();
  return new cv.Scalar(bgr[0], bgr[1], bgr[2]);
}

function drawPoly(
  mat: any,
  poly: [number, number][],
  W: number,
  H: number,
  color: Bgr,
  thickness = 2
): void {
  if (!poly || poly.length < 2) return;
  const cv = getCV();
  const flat = poly.flatMap(([nx, ny]) => [
    Math.max(0, Math.min(W - 1, Math.round(nx * W))),
    Math.max(0, Math.min(H - 1, Math.round(ny * H))),
  ]);
  const contourMat = cv.matFromArray(poly.length, 1, cv.CV_32SC2, flat);
  const vec = new cv.MatVector();
  vec.push_back(contourMat);
  cv.polylines(mat, vec, true, sc(color), thickness, cv.LINE_AA, 0);
  vec.delete();
  contourMat.delete();
}

function drawLabel(
  mat: any,
  text: string,
  px: number,
  py: number,
  W: number,
  H: number,
  bgColor: Bgr
): void {
  const cv = getCV();
  const fontScale = 0.40;
  const charW = 6;
  const charH = 10;
  const pad = 2;
  const boxW = Math.min(text.length * charW + pad * 2, W - px);
  const boxH = charH + pad * 2;

  const x0 = Math.max(0, Math.min(px, W - boxW - 1));
  const y0 = Math.max(0, Math.min(py, H - boxH - 1));

  cv.rectangle(mat, new cv.Point(x0, y0), new cv.Point(x0 + boxW, y0 + boxH), sc(bgColor), -1);
  cv.rectangle(mat, new cv.Point(x0, y0), new cv.Point(x0 + boxW, y0 + boxH), sc(WHITE), 1);
  cv.putText(
    mat, text,
    new cv.Point(x0 + pad, y0 + charH + pad - 1),
    cv.FONT_HERSHEY_SIMPLEX, fontScale,
    sc(WHITE),
    1, cv.LINE_AA, false
  );
}

function regionTopLeft(
  poly: [number, number][],
  W: number,
  H: number
): [number, number] {
  const xs = poly.map(([nx]) => nx * W);
  const ys = poly.map(([, ny]) => ny * H);
  return [Math.round(Math.min(...xs)), Math.round(Math.min(...ys))];
}

function bboxOfPoly(
  poly: [number, number][],
  W: number,
  H: number
): { x: number; y: number; w: number; h: number } {
  const xs = poly.map(([nx]) => nx * W);
  const ys = poly.map(([, ny]) => ny * H);
  const x = Math.round(Math.min(...xs));
  const y = Math.round(Math.min(...ys));
  const w = Math.round(Math.max(...xs)) - x;
  const h = Math.round(Math.max(...ys)) - y;
  return { x, y, w, h };
}

// ── Region types used by draw functions ───────────────────────────────────────

export interface AnnotatedRegion {
  x: number; y: number; w: number; h: number;
  polygon?: [number, number][];
  bubblePolygon?: [number, number][];
  type?: string;
  textClass?: string;
  index: number;
}

export interface RefinedAnnotation extends AnnotatedRegion {
  refinedBubblePolygon?: [number, number][];
}

// ── Stage 2: OCR overlay ──────────────────────────────────────────────────────
// All Gemini regions drawn on original image, colored by raw Gemini type.

export async function drawOCROverlay(
  imgBuf: Buffer,
  regions: AnnotatedRegion[]
): Promise<Buffer> {
  const { mat, w, h } = await toBGR(imgBuf);
  try {
    for (const r of regions) {
      const color = TYPE_BGR[(r.type ?? "speech").toLowerCase()] ?? GRAY;
      const poly = r.polygon ?? [
        [r.x, r.y], [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
      ] as [number, number][];
      drawPoly(mat, poly as [number, number][], w, h, color, 2);
      const [lx, ly] = regionTopLeft(poly as [number, number][], w, h);
      drawLabel(mat, `#${r.index} ${r.type ?? "?"}`, lx, Math.max(0, ly - 14), w, h, color);
    }
    return toPNG(mat, w, h);
  } finally {
    mat.delete();
  }
}

// ── Stage 3: Classification overlay ──────────────────────────────────────────
// Each region colored by TextClass. Bubble polygon outlined if present.

export async function drawClassificationOverlay(
  imgBuf: Buffer,
  regions: AnnotatedRegion[]
): Promise<Buffer> {
  const { mat, w, h } = await toBGR(imgBuf);
  try {
    for (const r of regions) {
      const cls = r.textClass ?? "unknown";
      const color = CLASS_BGR[cls] ?? GRAY;
      const poly = r.polygon ?? [
        [r.x, r.y], [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
      ] as [number, number][];
      if (r.bubblePolygon) {
        drawPoly(mat, r.bubblePolygon as [number, number][], w, h, color, 3);
      }
      drawPoly(mat, poly as [number, number][], w, h, color, 2);
      const [lx, ly] = regionTopLeft(poly as [number, number][], w, h);
      drawLabel(mat, `#${r.index} ${cls}`, lx, Math.max(0, ly - 14), w, h, color);
    }
    return toPNG(mat, w, h);
  } finally {
    mat.delete();
  }
}

// ── Stage 4: Bubble detection overlay ────────────────────────────────────────
// WHITE = OCR polygon, YELLOW = Gemini bubble polygon, GREEN = CV-refined polygon.

export async function drawBubbleOverlay(
  imgBuf: Buffer,
  regions: RefinedAnnotation[]
): Promise<Buffer> {
  const { mat, w, h } = await toBGR(imgBuf);
  try {
    for (const r of regions) {
      const poly = r.polygon ?? [
        [r.x, r.y], [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
      ] as [number, number][];

      drawPoly(mat, poly as [number, number][], w, h, WHITE, 1);

      if (r.bubblePolygon) {
        drawPoly(mat, r.bubblePolygon as [number, number][], w, h, YELLOW, 2);
      }

      if (r.refinedBubblePolygon) {
        const color = CLASS_BGR.speech_bubble;
        drawPoly(mat, r.refinedBubblePolygon as [number, number][], w, h, color, 3);
        const [lx, ly] = regionTopLeft(r.refinedBubblePolygon as [number, number][], w, h);
        drawLabel(mat, `#${r.index} CV(${r.refinedBubblePolygon.length}pts)`, lx, Math.max(0, ly - 14), w, h, color);
      } else {
        const [lx, ly] = regionTopLeft(poly as [number, number][], w, h);
        drawLabel(mat, `#${r.index} fallback`, lx, Math.max(0, ly - 14), w, h, GRAY);
      }
    }
    return toPNG(mat, w, h);
  } finally {
    mat.delete();
  }
}

// ── Stage 5: Segmentation mask ────────────────────────────────────────────────
// Binary mask rendered as a red overlay on top of the original image.

export async function drawMaskOverlay(
  imgBuf: Buffer,
  maskData: Buffer,
  maskW: number,
  maskH: number
): Promise<Buffer> {
  const cv = getCV();
  const { mat, w, h } = await toBGR(imgBuf);
  try {
    const resized = maskW !== w || maskH !== h
      ? await sharp(maskData, { raw: { width: maskW, height: maskH, channels: 1 } })
          .resize(w, h)
          .raw()
          .toBuffer()
      : maskData;

    const maskMat = new cv.Mat(h, w, cv.CV_8UC1);
    maskMat.data.set(new Uint8Array(resized.buffer, resized.byteOffset, resized.length));

    const overlay = cv.Mat.zeros(h, w, cv.CV_8UC3);
    overlay.setTo(new cv.Scalar(0, 0, 220));

    const maskBool = new cv.Mat();
    cv.threshold(maskMat, maskBool, 127, 255, cv.THRESH_BINARY);
    maskMat.delete();

    const overlayRegion = new cv.Mat();
    overlay.copyTo(overlayRegion, maskBool);
    maskBool.delete();
    overlay.delete();

    cv.addWeighted(mat, 0.6, overlayRegion, 0.4, 0, mat);
    overlayRegion.delete();

    return toPNG(mat, w, h);
  } finally {
    mat.delete();
  }
}

// ── Stage 7: Renderer overlay ─────────────────────────────────────────────────
// Shows final render bounding boxes on the inpainted image.
// GREEN box = will be rendered. RED box = skipped.

export async function drawRendererOverlay(
  inpaintedBuf: Buffer,
  allAnnotations: (AnnotatedRegion & { shouldRender: boolean })[],
  refined: RefinedAnnotation[]
): Promise<Buffer> {
  const { mat, w, h } = await toBGR(inpaintedBuf);
  try {
    for (const r of allAnnotations) {
      const rv = refined.find((rv) => rv.index === r.index);
      const poly = rv?.refinedBubblePolygon
        ?? r.bubblePolygon
        ?? r.polygon
        ?? [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] as [number, number][];

      const bb = bboxOfPoly(poly as [number, number][], w, h);
      const cv = getCV();
      const color = r.shouldRender
        ? sc(CLASS_BGR.speech_bubble)
        : sc(CLASS_BGR.chapter_title);

      cv.rectangle(
        mat,
        new cv.Point(bb.x, bb.y),
        new cv.Point(bb.x + bb.w, bb.y + bb.h),
        color,
        r.shouldRender ? 2 : 1
      );

      const label = r.shouldRender
        ? `#${r.index} RENDER`
        : `#${r.index} SKIP(${r.textClass ?? "?"})`;
      const lColor = r.shouldRender ? CLASS_BGR.speech_bubble : CLASS_BGR.chapter_title;
      drawLabel(mat, label, bb.x, Math.max(0, bb.y - 14), w, h, lColor);
    }
    return toPNG(mat, w, h);
  } finally {
    mat.delete();
  }
}
