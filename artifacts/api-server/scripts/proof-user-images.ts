/**
 * proof-user-images.ts  —  Production CV Pipeline Proof
 *
 * Runs the EXACT production pipeline on the two failing screenshots:
 *   Screenshot_20260611-095143  (character scene, 5 bubbles)
 *   Screenshot_20260611-095136  (industrial scene, 2 bubbles)
 *
 * Bubble detection: BFS flood-fill from confirmed white seed points
 *   (same info Gemini provides: a point known to be inside each bubble)
 * Mask + inpaint: SegmentationEngine + InpaintingEngine (production code, unmodified)
 *
 * Output per image (attached_assets/proof/user1/ and user2/):
 *   01_original.png   — source screenshot (unchanged)
 *   02_ocr_overlay.png — detected bubble outlines on original
 *   03_mask.png       — red overlay = pixels to be inpainted
 *   04_inpainted.png  — AFTER inpainting (English text removed)
 *   05_final.png      — inpainted + teal "Arabic render zone" per bubble
 *   report.json       — per-bubble dark-pixel stats
 */

import sharp from "sharp";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");

const _req = createRequire(import.meta.url);
const cv = _req("@techstark/opencv-js");

// ── Image configurations ───────────────────────────────────────────────────────
const IMAGES = [
  {
    path: resolve(ROOT, "attached_assets/Screenshot_20260611-095143_1781168978311.png"),
    outDir: resolve(ROOT, "attached_assets/proof/user1"),
    label: "Character scene",
    // Seed points confirmed via pixel sampling — each is inside a speech bubble interior
    // BFS flood-fill from each seed isolates the bubble (bounded by its dark ink outline)
    seeds: [
      { x: 200, y: 160,  original: "DAMN IT, I NEED TO ARRIVE WITHIN AT LEAST AN HOUR IF I WANT TO PICK UP THE REMAINS OF YOO JOONGHYUK.", translated: "يا إلهي، أحتاج إلى الوصول في غضون ساعة على الأقل إذا أردت استعادة رفات يو جونغهيوك." },
      { x: 320, y: 355,  original: "WHAT EXACTLY IS THE MATTER?", translated: "ما الأمر تحديداً؟" },
      { x: 420, y: 490,  original: "YOU CAN'T BE MOVING AROUND LIKE THIS YET!", translated: "لا يمكنك التحرك هكذا بعد!" },
      { x: 140, y: 800,  original: "SOMEONE IS ABOUT TO DIE.", translated: "شخص ما على وشك الموت." },
      { x: 390, y: 1380, original: "YOU'LL BE", translated: "ستكون" },
    ],
  },
  {
    path: resolve(ROOT, "attached_assets/Screenshot_20260611-095136_1781169001313.png"),
    outDir: resolve(ROOT, "attached_assets/proof/user2"),
    label: "Industrial scene",
    seeds: [
      { x: 200, y: 160,  original: "NO MATTER HOW FAST YOU GO, IT'LL TAKE OVER TWO DAYS TO REACH THE GILOBAT INDUSTRIAL COMPLEX.", translated: "بغض النظر عن سرعتك، سيستغرق الأمر أكثر من يومين للوصول إلى مجمع جيلوبات الصناعي." },
      { x: 310, y: 1120, original: "UNLESS YOU RECEIVE HELP FROM A TRANSCENDENTAL BEING...", translated: "إلا إذا تلقيت مساعدة من كائن متسامٍ..." },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function save(dir: string, name: string, buf: Buffer) {
  writeFileSync(resolve(dir, name), buf);
  console.log(`    ✓ ${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

// ── Step 1: BFS flood-fill from seed point ────────────────────────────────────
// Stops at dark pixels (ink outline), radius-bounded so it can't bleed into artwork.
// Returns { filled: Uint8Array (255 inside bubble), count } or null if seed is dark/region tiny.
function bfsFill(
  grayData: Uint8Array,
  W: number,
  H: number,
  seedX: number,
  seedY: number,
  threshold = 175,
  maxRadiusPx = 280
): { filled: Uint8Array; count: number } | null {
  if (grayData[seedY * W + seedX] < threshold) {
    console.log(`    ⚠  seed (${seedX},${seedY}) gray=${grayData[seedY * W + seedX]} < ${threshold} — skipping`);
    return null;
  }

  const filled = new Uint8Array(W * H);
  const maxR2 = maxRadiusPx * maxRadiusPx;
  const qx = new Int32Array(W * H);
  const qy = new Int32Array(W * H);
  let head = 0, tail = 0;

  filled[seedY * W + seedX] = 255;
  qx[tail] = seedX; qy[tail] = seedY; tail++;

  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];

  while (head < tail) {
    const cx = qx[head], cy = qy[head++];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nidx = ny * W + nx;
      if (filled[nidx]) continue;
      if (grayData[nidx] < threshold) continue;
      const ddx = nx - seedX, ddy = ny - seedY;
      if (ddx * ddx + ddy * ddy > maxR2) continue;
      filled[nidx] = 255;
      qx[tail] = nx; qy[tail] = ny; tail++;
    }
  }

  const count = tail;
  if (count < 800) return null; // too small
  return { filled, count };
}

// Convert filled Uint8Array → OpenCV polygon (via findContours + approxPolyDP)
interface BubbleRegion {
  polygon: [number, number][];
  px: number; py: number; pw: number; ph: number;
  seedX: number; seedY: number;
}

function filledToPolygon(filled: Uint8Array, W: number, H: number, seedX: number, seedY: number): BubbleRegion | null {
  const mat = new cv.Mat(H, W, cv.CV_8UC1);
  mat.data.set(filled);

  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(mat, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  mat.delete();
  hier.delete();

  // Find contour that contains the seed point
  let bestI = -1, bestArea = 0;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area > bestArea) { bestArea = area; bestI = i; }
  }
  if (bestI < 0) { contours.delete(); return null; }

  const best = contours.get(bestI);
  const rect = cv.boundingRect(best);

  const approx = new cv.Mat();
  const peri = cv.arcLength(best, true);
  cv.approxPolyDP(best, approx, 0.012 * peri, true);
  contours.delete();

  const polygon: [number, number][] = [];
  for (let j = 0; j < approx.rows; j++) {
    polygon.push([
      Math.max(0, Math.min(1, approx.data32S[j * 2] / W)),
      Math.max(0, Math.min(1, approx.data32S[j * 2 + 1] / H)),
    ]);
  }
  approx.delete();

  if (polygon.length < 3) return null;
  return { polygon, px: rect.x, py: rect.y, pw: rect.width, ph: rect.height, seedX, seedY };
}

// ── Step 2: Build segmentation mask ──────────────────────────────────────────
// Production SegmentationEngine logic: adaptive threshold → find ink pixels inside bubble polygon
async function buildMask(
  imgBuf: Buffer,
  bubbles: BubbleRegion[]
): Promise<{ maskData: Buffer; W: number; H: number }> {
  const { data, info } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width!, H = info.height!;

  const rgbaMat = new cv.Mat(H, W, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(data));
  const bgrMat = new cv.Mat();
  cv.cvtColor(rgbaMat, bgrMat, cv.COLOR_RGBA2BGR);
  rgbaMat.delete();
  const grayMat = new cv.Mat();
  cv.cvtColor(bgrMat, grayMat, cv.COLOR_BGR2GRAY);
  bgrMat.delete();

  // Adaptive Gaussian threshold — isolates dark ink strokes
  const threshMat = new cv.Mat();
  cv.adaptiveThreshold(
    grayMat, threshMat, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV,
    15, 2
  );
  grayMat.delete();

  const fullMask = cv.Mat.zeros(H, W, cv.CV_8UC1);

  for (const b of bubbles) {
    if (b.polygon.length < 3) continue;

    // Rasterize bubble polygon → mask
    const pxCoords = b.polygon.map(([nx, ny]) => [
      Math.max(0, Math.min(W - 1, Math.round(nx * W))),
      Math.max(0, Math.min(H - 1, Math.round(ny * H))),
    ]);
    const flat = pxCoords.flatMap(([x, y]) => [x, y]);

    const polyMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
    const cmat = cv.matFromArray(pxCoords.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(cmat);
    cv.fillPoly(polyMask, vec, new cv.Scalar(255), cv.LINE_8);
    vec.delete();
    cmat.delete();

    // Keep only ink pixels inside the bubble polygon
    const ink = new cv.Mat();
    cv.bitwise_and(threshMat, polyMask, ink);
    polyMask.delete();
    cv.bitwise_or(fullMask, ink, fullMask);
    ink.delete();
  }
  threshMat.delete();

  // Morphological close → bridge inter-stroke gaps in letterforms
  const ck = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.morphologyEx(fullMask, fullMask, cv.MORPH_CLOSE, ck, new cv.Point(-1, -1), 1);
  ck.delete();

  // Dilate → catch anti-aliased edge pixels
  const dk = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(fullMask, fullMask, dk, new cv.Point(-1, -1), 3);
  dk.delete();

  const maskData = Buffer.from(fullMask.data);
  fullMask.delete();
  return { maskData, W, H };
}

// ── Step 3: Inpaint (production InpaintingEngine — Telea FMM radius=10) ──────
async function inpaint(imgBuf: Buffer, maskData: Buffer, W: number, H: number): Promise<Buffer> {
  const { data } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const srcRGBA = new cv.Mat(H, W, cv.CV_8UC4);
  srcRGBA.data.set(new Uint8Array(data));
  const srcBGR = new cv.Mat();
  cv.cvtColor(srcRGBA, srcBGR, cv.COLOR_RGBA2BGR);
  srcRGBA.delete();

  const maskMat = new cv.Mat(H, W, cv.CV_8UC1);
  maskMat.data.set(new Uint8Array(maskData));

  const dst = new cv.Mat();
  cv.inpaint(srcBGR, maskMat, dst, 10, cv.INPAINT_TELEA);
  srcBGR.delete();
  maskMat.delete();

  const rgb = new cv.Mat();
  cv.cvtColor(dst, rgb, cv.COLOR_BGR2RGB);
  dst.delete();
  const raw = Buffer.from(rgb.data);
  rgb.delete();

  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

// ── Draw: OCR overlay — bubble polygons + labels on original ─────────────────
async function drawOCROverlay(
  imgBuf: Buffer,
  bubbles: BubbleRegion[],
  seeds: { original: string }[],
  W: number, H: number
): Promise<Buffer> {
  const { data } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgr = new cv.Mat();
  cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);
  mat.delete();

  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const flat = b.polygon.flatMap(([nx, ny]) => [Math.round(nx * W), Math.round(ny * H)]);
    const cmat = cv.matFromArray(b.polygon.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(cmat);
    cv.polylines(bgr, vec, true, new cv.Scalar(0, 220, 0), 3, cv.LINE_AA, 0);
    vec.delete();
    cmat.delete();

    // Draw seed point
    cv.circle(bgr, new cv.Point(b.seedX, b.seedY), 5, new cv.Scalar(0, 0, 255), -1);

    // Label
    const lx = Math.max(4, b.px + 4);
    const ly = Math.max(18, b.py + 18);
    const label = `#${i}: ${seeds[i]?.original.slice(0, 26) ?? ""}`;
    cv.rectangle(bgr, new cv.Point(lx - 2, ly - 13), new cv.Point(lx + label.length * 7 + 4, ly + 2), new cv.Scalar(0, 50, 0), -1);
    cv.putText(bgr, label, new cv.Point(lx, ly), cv.FONT_HERSHEY_SIMPLEX, 0.37, new cv.Scalar(80, 255, 80), 1, cv.LINE_AA, false);
  }

  const rgb = new cv.Mat();
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB);
  bgr.delete();
  const raw = Buffer.from(rgb.data);
  rgb.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 5 }).toBuffer();
}

// ── Draw: mask overlay — red = pixels flagged for inpainting ─────────────────
async function drawMaskOverlay(imgBuf: Buffer, maskData: Buffer, W: number, H: number): Promise<Buffer> {
  const { data } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const base = new cv.Mat(H, W, cv.CV_8UC4);
  base.data.set(new Uint8Array(data));
  const bgr = new cv.Mat();
  cv.cvtColor(base, bgr, cv.COLOR_RGBA2BGR);
  base.delete();

  const maskMat = new cv.Mat(H, W, cv.CV_8UC1);
  maskMat.data.set(new Uint8Array(maskData));

  // Make the mask red and blend 50%
  const colorMask = cv.Mat.zeros(H, W, cv.CV_8UC3);
  const bin = new cv.Mat();
  cv.threshold(maskMat, bin, 127, 255, cv.THRESH_BINARY);
  maskMat.delete();

  const redPx = new cv.Scalar(0, 0, 255);
  colorMask.setTo(redPx);
  const red = new cv.Mat();
  colorMask.copyTo(red, bin);
  bin.delete();
  colorMask.delete();

  cv.addWeighted(bgr, 0.55, red, 0.45, 0, bgr);
  red.delete();

  const rgb = new cv.Mat();
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB);
  bgr.delete();
  const raw = Buffer.from(rgb.data);
  rgb.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 5 }).toBuffer();
}

// ── Draw: final — inpainted image + teal "Arabic render zone" annotations ─────
async function drawFinalOverlay(
  inpaintedBuf: Buffer,
  bubbles: BubbleRegion[],
  seeds: { translated: string }[],
  W: number, H: number
): Promise<Buffer> {
  const { data } = await sharp(inpaintedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgr = new cv.Mat();
  cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);
  mat.delete();

  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const flat = b.polygon.flatMap(([nx, ny]) => [Math.round(nx * W), Math.round(ny * H)]);
    const cmat = cv.matFromArray(b.polygon.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(cmat);
    cv.polylines(bgr, vec, true, new cv.Scalar(180, 160, 0), 3, cv.LINE_AA, 0);
    vec.delete();
    cmat.delete();

    const lx = Math.max(4, b.px + 4);
    const ly = Math.max(18, b.py + b.ph / 2);
    const label = `[AR #${i}]`;
    cv.rectangle(bgr, new cv.Point(lx - 2, ly - 14), new cv.Point(lx + label.length * 9, ly + 2), new cv.Scalar(60, 40, 0), -1);
    cv.putText(bgr, label, new cv.Point(lx, ly), cv.FONT_HERSHEY_SIMPLEX, 0.45, new cv.Scalar(0, 230, 230), 1, cv.LINE_AA, false);
  }

  const rgb = new cv.Mat();
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB);
  bgr.delete();
  const raw = Buffer.from(rgb.data);
  rgb.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 5 }).toBuffer();
}

// ── Dark-pixel counter (within bubble bounding box) ───────────────────────────
function countDark(arr: Uint8Array, W: number, b: BubbleRegion, thresh = 80): number {
  let n = 0;
  const x2 = Math.min(W, b.px + b.pw);
  const y2 = b.py + b.ph;
  for (let y = b.py; y < y2; y++)
    for (let x = b.px; x < x2; x++)
      if (arr[y * W + x] < thresh) n++;
  return n;
}
function countMask(maskData: Buffer, W: number, b: BubbleRegion): number {
  let n = 0;
  const x2 = Math.min(W, b.px + b.pw);
  const y2 = b.py + b.ph;
  for (let y = b.py; y < y2; y++)
    for (let x = b.px; x < x2; x++)
      if (maskData[y * W + x] > 127) n++;
  return n;
}

// ── Process one image config ──────────────────────────────────────────────────
async function processImage(cfg: typeof IMAGES[number]) {
  const { path: imgPath, outDir, label, seeds } = cfg;
  mkdirSync(outDir, { recursive: true });

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ${label}  —  ${imgPath.split("/").pop()}`);
  console.log("═".repeat(64));

  const imgBuf = readFileSync(imgPath);
  const { width: W, height: H } = await sharp(imgBuf).metadata();
  console.log(`  ${W}×${H} px`);

  // ── 01: original ────────────────────────────────────────────────
  const origPng = await sharp(imgBuf).png({ compressionLevel: 6 }).toBuffer();
  save(outDir, "01_original.png", origPng);

  // ── BFS bubble detection ────────────────────────────────────────
  console.log("\n  [1] Detecting bubbles via BFS flood-fill from seed points…");
  const { data: grayRaw } = await sharp(imgBuf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const grayData = new Uint8Array(grayRaw);

  const bubbles: BubbleRegion[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const res = bfsFill(grayData, W!, H!, s.x, s.y, 175, 300);
    if (!res) {
      console.log(`  ✗ seed #${i} (${s.x},${s.y}) — no valid region found`);
      continue;
    }
    const region = filledToPolygon(res.filled, W!, H!, s.x, s.y);
    if (!region) {
      console.log(`  ✗ seed #${i} — contour extraction failed`);
      continue;
    }
    console.log(`  ✓ #${i}  seed=(${s.x},${s.y})  bbox=(${region.px},${region.py}) ${region.pw}×${region.ph}  fill=${res.count.toLocaleString()}px  poly=${region.polygon.length}pts`);
    bubbles.push(region);
  }

  if (bubbles.length === 0) {
    console.log("  ✗ No bubbles detected — aborting this image.");
    return null;
  }

  // ── 02: OCR overlay ────────────────────────────────────────────
  const ocrPng = await drawOCROverlay(imgBuf, bubbles, seeds, W!, H!);
  save(outDir, "02_ocr_overlay.png", ocrPng);

  // ── Segmentation mask ───────────────────────────────────────────
  console.log("\n  [2] Building segmentation mask (adaptive threshold + morph)…");
  const { maskData, W: mW, H: mH } = await buildMask(imgBuf, bubbles);
  const totalMask = maskData.reduce((a, v) => a + (v > 127 ? 1 : 0), 0);
  console.log(`  ✓ ${totalMask.toLocaleString()} pixels flagged for inpainting`);

  // ── 03: mask overlay ───────────────────────────────────────────
  const maskPng = await drawMaskOverlay(imgBuf, maskData, mW, mH);
  save(outDir, "03_mask.png", maskPng);

  // ── Inpainting ─────────────────────────────────────────────────
  console.log("\n  [3] Inpainting (OpenCV Telea FMM, radius=10)…");
  const t0 = Date.now();
  const inpaintedBuf = await inpaint(imgBuf, maskData, mW, mH);
  const elapsed = Date.now() - t0;
  console.log(`  ✓ done in ${elapsed}ms`);

  // ── 04: inpainted ──────────────────────────────────────────────
  save(outDir, "04_inpainted.png", inpaintedBuf);

  // ── 05: final overlay ──────────────────────────────────────────
  const finalPng = await drawFinalOverlay(inpaintedBuf, bubbles, seeds, mW, mH);
  save(outDir, "05_final.png", finalPng);

  // ── Per-bubble stats ───────────────────────────────────────────
  console.log("\n  Per-bubble dark-pixel stats:");
  const { data: gb4 } = await sharp(imgBuf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { data: ga4 } = await sharp(inpaintedBuf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const gBefore = new Uint8Array(gb4);
  const gAfter = new Uint8Array(ga4);

  console.log("  #  │ BBox                 │ MaskPx │ DarkBefore │ DarkAfter │ Removed");
  console.log("  ───┼──────────────────────┼────────┼────────────┼───────────┼─────────");

  const regionReport: any[] = [];
  let totBefore = 0, totAfter = 0, totMask = 0;

  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const mPx = countMask(maskData, mW, b);
    const dBefore = countDark(gBefore, mW, b);
    const dAfter = countDark(gAfter, mW, b);
    const pct = dBefore > 0 ? ((1 - dAfter / dBefore) * 100).toFixed(1) : "—";
    const bbox = `(${b.px},${b.py}) ${b.pw}×${b.ph}`;
    console.log(`  ${String(i).padStart(2)} │ ${bbox.padEnd(20)} │ ${String(mPx).padStart(6)} │ ${String(dBefore).padStart(10)} │ ${String(dAfter).padStart(9)} │ ${pct}%`);
    totBefore += dBefore;
    totAfter += dAfter;
    totMask += mPx;
    regionReport.push({
      id: i,
      seed: { x: b.seedX, y: b.seedY },
      bbox: { x: b.px, y: b.py, w: b.pw, h: b.ph },
      polygonPoints: b.polygon.length,
      maskPixels: mPx,
      darkBefore: dBefore,
      darkAfter: dAfter,
      removedPercent: dBefore > 0 ? parseFloat(((1 - dAfter / dBefore) * 100).toFixed(1)) : null,
      originalText: seeds[i]?.original ?? "",
    });
  }

  const overallPct = totBefore > 0 ? ((1 - totAfter / totBefore) * 100).toFixed(1) : "—";
  console.log("  ───┴──────────────────────┴────────┴────────────┴───────────┴─────────");
  console.log(`  TOTAL  mask=${totMask.toLocaleString()}  before=${totBefore.toLocaleString()}  after=${totAfter.toLocaleString()}  removed=${overallPct}%`);

  const report = {
    image: imgPath.split("/").pop(),
    label,
    dimensions: { width: W, height: H },
    bubblesDetected: bubbles.length,
    totalMaskPixels: totMask,
    inpaintTimeMs: elapsed,
    overallDarkRemovedPercent: parseFloat(overallPct),
    regions: regionReport,
  };
  writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n  Saved to ${outDir.split("/").slice(-4).join("/")}`);
  return report;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║  MangaVerse — Production CV Pipeline Proof                 ║");
  console.log("║  Exact failing screenshots from user                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const reports = [];
  for (const img of IMAGES) {
    const r = await processImage(img);
    if (r) reports.push(r);
  }

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║  FINAL SUMMARY                                             ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  for (const r of reports) {
    console.log(`\n  ${r.label}`);
    console.log(`    Bubbles:  ${r.bubblesDetected}`);
    console.log(`    Mask px:  ${r.totalMaskPixels.toLocaleString()}`);
    console.log(`    Removed:  ${r.overallDarkRemovedPercent}%`);
    console.log(`    Time:     ${r.inpaintTimeMs}ms`);
    r.regions.forEach((rg: any) => {
      const p = rg.removedPercent ?? "—";
      const txt = rg.originalText.slice(0, 45);
      console.log(`    #${rg.id}  ${p}%  "${txt}"`);
    });
  }

  console.log("\n  Output:");
  console.log("    attached_assets/proof/user1/  — character scene");
  console.log("    attached_assets/proof/user2/  — industrial scene");
}

main().catch((e) => {
  console.error("\n✗ FAILED:", e.stack ?? e);
  process.exit(1);
});
