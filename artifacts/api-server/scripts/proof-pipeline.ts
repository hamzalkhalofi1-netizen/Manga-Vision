/**
 * proof-pipeline.ts
 *
 * Downloads a real MangaDex manga page, auto-detects speech bubbles via
 * OpenCV white-region analysis, runs the full CV whitening pipeline, and
 * saves four proof images with per-region dark-pixel stats.
 *
 * Run:  cd artifacts/api-server && pnpm exec tsx scripts/proof-pipeline.ts
 * Output: attached_assets/proof/
 *   01_original.png   — source page, unmodified
 *   02_mask.png       — red overlay showing exactly which pixels will be removed
 *   03_inpainted.png  — AFTER inpainting (English text gone, bubble bg restored)
 *   04_annotated.png  — inpainted + per-region bounding boxes with pixel stats
 */

import sharp from "sharp";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load OpenCV (CJS require — same as cv/index.ts) ───────────────────────────
const _req = createRequire(import.meta.url);
const cv = _req("@techstark/opencv-js");

// ── Output directory ──────────────────────────────────────────────────────────
const OUT_DIR = resolve(__dirname, "../../../attached_assets/proof");
mkdirSync(OUT_DIR, { recursive: true });

function save(name: string, buf: Buffer) {
  const p = resolve(OUT_DIR, name);
  writeFileSync(p, buf);
  console.log(`  ✓ saved ${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

// ── CDN fetch ─────────────────────────────────────────────────────────────────
const CDN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

async function fetchBuf(url: string, referer = "https://mangadex.org/"): Promise<Buffer> {
  const r = await fetch(url, {
    headers: { "User-Agent": CDN_UA, Referer: referer, Accept: "image/*,*/*" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// ── MangaDex: get a real page URL for Chainsaw Man Ch.1 ──────────────────────
async function getMangaDexPageUrl(): Promise<string> {
  console.log("  → querying MangaDex API for Chainsaw Man Ch.1 …");

  // Chainsaw Man manga UUID
  const MANGA_ID = "a77742b1-befd-49a4-bff5-1ad4e6b0ef7b";
  const chapterUrl =
    `https://api.mangadex.org/chapter` +
    `?manga=${MANGA_ID}&translatedLanguage[]=en&order[chapter]=asc&limit=10`;

  const chRes = await fetch(chapterUrl, {
    headers: { "User-Agent": CDN_UA, Accept: "application/json" },
  });
  if (!chRes.ok) throw new Error(`MangaDex chapters HTTP ${chRes.status}`);
  const chData = (await chRes.json()) as any;
  const chapters: any[] = chData?.data ?? [];
  if (!chapters.length) throw new Error("No chapters found");

  // Find the first chapter that has actual CDN pages (some early chapters may be purged)
  for (const ch of chapters) {
    const chId: string = ch.id;
    const chNum: string = ch.attributes?.chapter ?? "?";

    const atHomeUrl = `https://api.mangadex.org/at-home/server/${chId}`;
    const atHomeRes = await fetch(atHomeUrl, {
      headers: { "User-Agent": CDN_UA, Accept: "application/json" },
    });
    if (!atHomeRes.ok) continue;
    const atHome = (await atHomeRes.json()) as any;
    const baseUrl: string = atHome.baseUrl ?? "";
    const hash: string = atHome.chapter?.hash ?? "";
    const pages: string[] = atHome.chapter?.data ?? [];

    if (!pages.length || !baseUrl || !hash) {
      console.log(`  → ch.${chNum} id=${chId}: no CDN pages, skipping`);
      continue;
    }

    // Use page index 3 (0-based = page 4) — typical dialogue/action page
    const pageFile = pages[Math.min(3, pages.length - 1)];
    const pageUrl = `${baseUrl}/data/${hash}/${pageFile}`;
    console.log(`  → ch.${chNum} id=${chId}: ${pages.length} pages`);
    console.log(`  → page URL: ${pageUrl.slice(0, 90)}…`);
    return pageUrl;
  }

  throw new Error("No working chapters found with CDN pages");
}

// ── Auto-detect speech bubbles via white-region analysis ─────────────────────
interface Region {
  polygon: [number, number][];
  bubblePolygon: [number, number][];
  x: number; y: number; w: number; h: number;
  px: number; py: number; pw: number; ph: number; // pixel coords
}

function detectSpeechBubbles(rawRGBA: Buffer, W: number, H: number): Region[] {
  const rgbaMat = new cv.Mat(H, W, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(rawRGBA));

  const gray = new cv.Mat();
  cv.cvtColor(rgbaMat, gray, cv.COLOR_RGBA2GRAY);
  rgbaMat.delete();

  // Threshold: pixels > 210 brightness = white bubble interior
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 210, 255, cv.THRESH_BINARY);
  gray.delete();

  // Close small gaps within a bubble's interior
  const k15 = cv.Mat.ones(15, 15, cv.CV_8U);
  cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, k15);
  k15.delete();

  // Erode slightly to remove thin panel borders / gutters
  const k5 = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.erode(thresh, thresh, k5);
  k5.delete();

  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  thresh.delete();
  hier.delete();

  const regions: Region[] = [];
  const n = contours.size();

  for (let i = 0; i < n; i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);

    // Min 800 px², max 25% of page area; skip full-width caption bars
    if (area < 800 || area > W * H * 0.25) continue;

    const rect = cv.boundingRect(c);
    const { x, y, width: w, height: h } = rect;
    const ar = w / h;

    // Reject extremely thin/wide strips (panel borders, horizontal gutters)
    if (ar > 8 || ar < 0.12) continue;

    // Reject regions that span > 92% of page width (likely panel background)
    if (w / W > 0.92) continue;

    // Simplify contour
    const approx = new cv.Mat();
    const peri = cv.arcLength(c, true);
    cv.approxPolyDP(c, approx, 0.018 * peri, true);

    const nPts = approx.rows;
    if (nPts >= 4 && nPts <= 20) {
      const polygon: [number, number][] = [];
      for (let j = 0; j < nPts; j++) {
        polygon.push([
          Math.max(0, Math.min(1, approx.data32S[j * 2] / W)),
          Math.max(0, Math.min(1, approx.data32S[j * 2 + 1] / H)),
        ]);
      }
      regions.push({
        polygon,
        bubblePolygon: polygon,
        x: x / W, y: y / H, w: w / W, h: h / H,
        px: x, py: y, pw: w, ph: h,
      });
    }
    approx.delete();
  }

  contours.delete();
  return regions;
}

// ── Count dark pixels inside a bounding box (on a grayscale buffer) ───────────
function countDarkPx(grayBuf: Uint8Array, W: number, region: Region, threshold = 80): number {
  const x1 = region.px;
  const y1 = region.py;
  const x2 = region.px + region.pw;
  const y2 = region.py + region.ph;
  let count = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      if (grayBuf[y * W + x] < threshold) count++;
    }
  }
  return count;
}

// ── Draw annotated result image ───────────────────────────────────────────────
interface RegionStat {
  region: Region;
  idx: number;
  darkBefore: number;
  darkAfter: number;
  maskPx: number;
}

async function drawAnnotated(
  inpaintedBuf: Buffer,
  stats: RegionStat[]
): Promise<Buffer> {
  const { data, info } = await sharp(inpaintedBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgrMat = new cv.Mat();
  cv.cvtColor(mat, bgrMat, cv.COLOR_RGBA2BGR);
  mat.delete();

  for (const s of stats) {
    const r = s.region;
    const pct = s.darkBefore > 0
      ? Math.round((1 - s.darkAfter / s.darkBefore) * 100)
      : 0;

    // Box color: green if good removal (>50%), orange if partial
    const color = pct >= 50
      ? new cv.Scalar(0, 200, 0)
      : new cv.Scalar(0, 120, 255);

    cv.rectangle(
      bgrMat,
      new cv.Point(r.px, r.py),
      new cv.Point(r.px + r.pw, r.py + r.ph),
      color, 2
    );

    // Label: #id  before→after  pct%
    const label = `#${s.idx} ${s.darkBefore}->${s.darkAfter} (${pct}% removed)`;
    const fontScale = 0.38;
    const thickness = 1;
    // Estimate label box width: ~9px per char at this scale
    const estimatedW = label.length * 9 + 4;
    const estimatedH = 14;

    const tx = Math.max(0, r.px);
    const ty = Math.max(estimatedH, r.py - 2);

    cv.rectangle(
      bgrMat,
      new cv.Point(tx, ty - estimatedH),
      new cv.Point(tx + estimatedW, ty + 2),
      pct >= 50 ? new cv.Scalar(0, 70, 0) : new cv.Scalar(0, 45, 110),
      -1
    );
    cv.putText(
      bgrMat, label,
      new cv.Point(tx + 2, ty - 2),
      cv.FONT_HERSHEY_SIMPLEX, fontScale,
      new cv.Scalar(255, 255, 255),
      thickness, cv.LINE_AA, false
    );
  }

  const rgbMat = new cv.Mat();
  cv.cvtColor(bgrMat, rgbMat, cv.COLOR_BGR2RGB);
  bgrMat.delete();
  const raw = Buffer.from(rgbMat.data);
  rgbMat.delete();

  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

// ── Draw mask as red overlay ──────────────────────────────────────────────────
async function drawMaskOverlay(
  imgBuf: Buffer,
  maskData: Buffer,
  W: number,
  H: number
): Promise<Buffer> {
  const { data } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgrMat = new cv.Mat();
  cv.cvtColor(mat, bgrMat, cv.COLOR_RGBA2BGR);
  mat.delete();

  const maskMat = new cv.Mat(H, W, cv.CV_8UC1);
  maskMat.data.set(new Uint8Array(maskData));

  const overlay = cv.Mat.zeros(H, W, cv.CV_8UC3);
  overlay.setTo(new cv.Scalar(0, 0, 220));   // pure red in BGR

  const maskBool = new cv.Mat();
  cv.threshold(maskMat, maskBool, 127, 255, cv.THRESH_BINARY);
  maskMat.delete();

  const overlayRegion = new cv.Mat();
  overlay.copyTo(overlayRegion, maskBool);
  maskBool.delete();
  overlay.delete();

  cv.addWeighted(bgrMat, 0.55, overlayRegion, 0.45, 0, bgrMat);
  overlayRegion.delete();

  const rgbMat = new cv.Mat();
  cv.cvtColor(bgrMat, rgbMat, cv.COLOR_BGR2RGB);
  bgrMat.delete();
  const raw = Buffer.from(rgbMat.data);
  rgbMat.delete();

  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

// ── Segmentation (mirrors SegmentationEngine.ts exactly) ─────────────────────
async function buildMask(imgBuf: Buffer, regions: Region[]): Promise<{ maskData: Buffer; W: number; H: number }> {
  const { data, info } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const rgbaMat = new cv.Mat(H, W, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(data));

  const bgrMat = new cv.Mat();
  cv.cvtColor(rgbaMat, bgrMat, cv.COLOR_RGBA2BGR);
  rgbaMat.delete();

  const grayMat = new cv.Mat();
  cv.cvtColor(bgrMat, grayMat, cv.COLOR_BGR2GRAY);
  bgrMat.delete();

  const threshMat = new cv.Mat();
  cv.adaptiveThreshold(grayMat, threshMat, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 2);
  grayMat.delete();

  const fullMask = cv.Mat.zeros(H, W, cv.CV_8UC1);

  for (const region of regions) {
    const poly = region.bubblePolygon ?? region.polygon;
    if (!poly || poly.length < 3) continue;

    const pxCoords = poly.map(([nx, ny]) => [
      Math.max(0, Math.min(W - 1, Math.round(nx * W))),
      Math.max(0, Math.min(H - 1, Math.round(ny * H))),
    ]);
    const flat = pxCoords.flatMap(([x, y]) => [x, y]);

    const polyMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
    const contourMat = cv.matFromArray(pxCoords.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(contourMat);
    cv.fillPoly(polyMask, vec, new cv.Scalar(255), cv.LINE_8);
    vec.delete();
    contourMat.delete();

    const regionInk = new cv.Mat();
    cv.bitwise_and(threshMat, polyMask, regionInk);
    polyMask.delete();
    cv.bitwise_or(fullMask, regionInk, fullMask);
    regionInk.delete();
  }

  threshMat.delete();

  const ck = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.morphologyEx(fullMask, fullMask, cv.MORPH_CLOSE, ck, new cv.Point(-1, -1), 1);
  ck.delete();

  const dk = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(fullMask, fullMask, dk, new cv.Point(-1, -1), 3);
  dk.delete();

  const maskData = Buffer.from(fullMask.data);
  fullMask.delete();

  return { maskData, W, H };
}

// ── Inpainting (mirrors InpaintingEngine.ts exactly) ─────────────────────────
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

  const resultRGB = new cv.Mat();
  cv.cvtColor(dst, resultRGB, cv.COLOR_BGR2RGB);
  dst.delete();

  const raw = Buffer.from(resultRGB.data);
  resultRGB.delete();

  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

// ── Count mask pixels ─────────────────────────────────────────────────────────
function countMaskPx(maskData: Buffer, W: number, region: Region): number {
  const x1 = region.px;
  const y1 = region.py;
  const x2 = region.px + region.pw;
  const y2 = region.py + region.ph;
  let count = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      if (maskData[y * W + x] > 127) count++;
    }
  }
  return count;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  MangaVerse CV Pipeline — Inpainting Proof");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── 1. Fetch manga page ────────────────────────────────────────────────────
  console.log("[1/6] Fetching manga page from MangaDex…");
  let pageUrl: string;
  let imgBuf: Buffer;
  try {
    pageUrl = await getMangaDexPageUrl();
    imgBuf = await fetchBuf(pageUrl);
    console.log(`  ✓ downloaded ${(imgBuf.length / 1024).toFixed(1)} KB`);
  } catch (e) {
    // Fallback: use a known-working Chainsaw Man page URL
    console.warn("  ! MangaDex API failed, using fallback URL");
    pageUrl = "https://uploads.mangadex.org/data/";
    throw e;
  }

  // Save original
  const originalPng = await sharp(imgBuf).png().toBuffer();
  save("01_original.png", originalPng);
  const { width: W, height: H } = await sharp(imgBuf).metadata();
  console.log(`  image dimensions: ${W}×${H} px`);

  // ── 2. Auto-detect speech bubbles ─────────────────────────────────────────
  console.log("\n[2/6] Auto-detecting speech bubbles via OpenCV white-region analysis…");
  const { data: rawRGBA } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const regions = detectSpeechBubbles(rawRGBA, W!, H!);
  console.log(`  ✓ detected ${regions.length} candidate bubble regions`);

  if (regions.length === 0) {
    console.error("  ✗ no regions detected — page may have dark backgrounds");
    process.exit(1);
  }

  // ── 3. Count dark pixels BEFORE inpainting ────────────────────────────────
  console.log("\n[3/6] Counting dark pixels per region BEFORE inpainting…");
  const { data: grayRawBefore } = await sharp(imgBuf)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const grayBefore = new Uint8Array(grayRawBefore);

  const preCounts = regions.map((r) => countDarkPx(grayBefore, W!, r));

  // ── 4. Build text mask + save mask image ──────────────────────────────────
  console.log("\n[4/6] Building text segmentation mask (SegmentationEngine)…");
  const { maskData, W: mW, H: mH } = await buildMask(imgBuf, regions);
  const totalMaskPx = maskData.reduce((a, v) => a + (v > 127 ? 1 : 0), 0);
  console.log(`  ✓ mask built: ${totalMaskPx.toLocaleString()} pixels flagged for inpainting`);

  const maskOverlayPng = await drawMaskOverlay(imgBuf, maskData, mW, mH);
  save("02_mask.png", maskOverlayPng);

  // ── 5. Inpaint ────────────────────────────────────────────────────────────
  console.log("\n[5/6] Inpainting with OpenCV Telea FMM (radius=10)…");
  const t0 = Date.now();
  const inpaintedBuf = await inpaint(imgBuf, maskData, mW, mH);
  console.log(`  ✓ inpainting complete in ${Date.now() - t0}ms`);
  save("03_inpainted.png", inpaintedBuf);

  // ── 6. Count dark pixels AFTER + build annotated image ───────────────────
  console.log("\n[6/6] Counting dark pixels AFTER inpainting & building annotated image…");
  const { data: grayRawAfter } = await sharp(inpaintedBuf)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const grayAfter = new Uint8Array(grayRawAfter);

  const stats: RegionStat[] = regions.map((region, idx) => ({
    region,
    idx,
    darkBefore: preCounts[idx],
    darkAfter: countDarkPx(grayAfter, mW, region),
    maskPx: countMaskPx(maskData, mW, region),
  }));

  const annotatedPng = await drawAnnotated(inpaintedBuf, stats);
  save("04_annotated.png", annotatedPng);

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Per-Region Statistics");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(
    "  #  │ BBox (px)              │ MaskPx │ DarkBefore │ DarkAfter │ Removed"
  );
  console.log("  ───┼────────────────────────┼────────┼────────────┼───────────┼────────");

  let totalBefore = 0;
  let totalAfter = 0;
  let totalMask = 0;

  for (const s of stats) {
    const r = s.region;
    const pct =
      s.darkBefore > 0
        ? ((1 - s.darkAfter / s.darkBefore) * 100).toFixed(1)
        : "—";
    const bbox = `(${r.px},${r.py}) ${r.pw}×${r.ph}`;
    console.log(
      `  ${String(s.idx).padStart(2)} │ ${bbox.padEnd(22)} │ ${String(s.maskPx).padStart(6)} │ ${String(s.darkBefore).padStart(10)} │ ${String(s.darkAfter).padStart(9)} │ ${pct}%`
    );
    totalBefore += s.darkBefore;
    totalAfter += s.darkAfter;
    totalMask += s.maskPx;
  }

  console.log("  ───┴────────────────────────┴────────┴────────────┴───────────┴────────");
  const overallPct =
    totalBefore > 0
      ? ((1 - totalAfter / totalBefore) * 100).toFixed(1)
      : "—";
  console.log(
    `  TOTAL  regions=${stats.length}  maskPx=${totalMask.toLocaleString()}  ` +
    `darkBefore=${totalBefore.toLocaleString()}  darkAfter=${totalAfter.toLocaleString()}  ` +
    `removed=${overallPct}%`
  );

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Output files saved to attached_assets/proof/");
  console.log("    01_original.png   — source page, unmodified");
  console.log("    02_mask.png       — red = pixels that WILL be removed");
  console.log("    03_inpainted.png  — English text REMOVED, bg restored");
  console.log("    04_annotated.png  — per-region dark-pixel stats overlay");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── JSON report ───────────────────────────────────────────────────────────
  const report = {
    pageUrl,
    imageDimensions: { width: W, height: H },
    totalMaskPixels: totalMask,
    regions: stats.map((s) => ({
      id: s.idx,
      type: "speech_bubble_candidate",
      ocrBbox: { x: s.region.px, y: s.region.py, w: s.region.pw, h: s.region.ph },
      maskPixels: s.maskPx,
      darkPixelsBefore: s.darkBefore,
      darkPixelsAfter: s.darkAfter,
      removedPercent: s.darkBefore > 0
        ? parseFloat(((1 - s.darkAfter / s.darkBefore) * 100).toFixed(1))
        : 0,
    })),
    summary: {
      totalDarkBefore: totalBefore,
      totalDarkAfter: totalAfter,
      overallRemovedPercent: parseFloat(overallPct),
    },
  };

  const reportPath = resolve(OUT_DIR, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  ✓ report.json written\n`);
}

main().catch((e) => {
  console.error("\n✗ proof-pipeline failed:", e);
  process.exit(1);
});
