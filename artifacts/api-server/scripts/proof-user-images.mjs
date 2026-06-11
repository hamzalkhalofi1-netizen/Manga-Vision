import sharp from "sharp";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const _req = createRequire(import.meta.url);
const cv = _req("@techstark/opencv-js");
const IMAGES = [
  {
    path: resolve(ROOT, "attached_assets/Screenshot_20260611-095143_1781168978311.png"),
    outDir: resolve(ROOT, "attached_assets/proof/user1"),
    label: "Character scene (5 bubbles)",
    // Text visible in each bubble in reading order (top→bottom, left→right)
    texts: [
      { original: "DAMN IT, I NEED TO ARRIVE WITHIN AT LEAST AN HOUR IF I WANT TO PICK UP THE REMAINS OF YOO JOONGHYUK.", translated: "\u064A\u0627 \u0625\u0644\u0647\u064A\u060C \u0623\u062D\u062A\u0627\u062C \u0625\u0644\u0649 \u0627\u0644\u0648\u0635\u0648\u0644 \u0641\u064A \u063A\u0636\u0648\u0646 \u0633\u0627\u0639\u0629 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0625\u0630\u0627 \u0623\u0631\u062F\u062A \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0631\u0641\u0627\u062A \u064A\u0648 \u062C\u0648\u0646\u063A\u0647\u064A\u0648\u0643.", type: "speech" },
      { original: "WHAT EXACTLY IS THE MATTER?", translated: "\u0645\u0627 \u0627\u0644\u0623\u0645\u0631 \u062A\u062D\u062F\u064A\u062F\u0627\u064B\u061F", type: "speech" },
      { original: "YOU CAN'T BE MOVING AROUND LIKE THIS YET!", translated: "\u0644\u0627 \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u062A\u062D\u0631\u0643 \u0647\u0643\u0630\u0627 \u0628\u0639\u062F!", type: "speech" },
      { original: "SOMEONE IS ABOUT TO DIE.", translated: "\u0634\u062E\u0635 \u0645\u0627 \u0639\u0644\u0649 \u0648\u0634\u0643 \u0627\u0644\u0645\u0648\u062A.", type: "speech" },
      { original: "YOU'LL BE", translated: "\u0633\u062A\u0643\u0648\u0646", type: "speech" }
    ]
  },
  {
    path: resolve(ROOT, "attached_assets/Screenshot_20260611-095136_1781169001313.png"),
    outDir: resolve(ROOT, "attached_assets/proof/user2"),
    label: "Industrial scene (2 bubbles)",
    texts: [
      { original: "NO MATTER HOW FAST YOU GO, IT'LL TAKE OVER TWO DAYS TO REACH THE GILOBAT INDUSTRIAL COMPLEX.", translated: "\u0628\u063A\u0636 \u0627\u0644\u0646\u0638\u0631 \u0639\u0646 \u0633\u0631\u0639\u062A\u0643\u060C \u0633\u064A\u0633\u062A\u063A\u0631\u0642 \u0627\u0644\u0623\u0645\u0631 \u0623\u0643\u062B\u0631 \u0645\u0646 \u064A\u0648\u0645\u064A\u0646 \u0644\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0645\u062C\u0645\u0639 \u062C\u064A\u0644\u0648\u0628\u0627\u062A \u0627\u0644\u0635\u0646\u0627\u0639\u064A.", type: "speech" },
      { original: "UNLESS YOU RECEIVE HELP FROM A TRANSCENDENTAL BEING...", translated: "\u0625\u0644\u0627 \u0625\u0630\u0627 \u062A\u0644\u0642\u064A\u062A \u0645\u0633\u0627\u0639\u062F\u0629 \u0645\u0646 \u0643\u0627\u0626\u0646 \u0645\u062A\u0633\u0627\u0645\u064D...", type: "speech" }
    ]
  }
];
function save(dir, name, buf) {
  const p = resolve(dir, name);
  writeFileSync(p, buf);
  const kb = (buf.length / 1024).toFixed(1);
  console.log(`    \u2713 ${name}  (${kb} KB)`);
}
function detectBubbles(rawRGBA, W, H) {
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(rawRGBA));
  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  mat.delete();
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 215, 255, cv.THRESH_BINARY);
  gray.delete();
  const kClose = cv.Mat.ones(20, 20, cv.CV_8U);
  cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kClose);
  kClose.delete();
  const kErode = cv.Mat.ones(4, 4, cv.CV_8U);
  cv.erode(thresh, thresh, kErode);
  kErode.delete();
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  thresh.delete();
  hier.delete();
  const bubbles = [];
  const n = contours.size();
  for (let i = 0; i < n; i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area < 1500 || area > W * H * 0.25) continue;
    const rect = cv.boundingRect(c);
    const { x, y, width: w, height: h } = rect;
    const ar = w / h;
    if (ar > 6 || ar < 0.15) continue;
    if (w / W > 0.94) continue;
    const approx = new cv.Mat();
    const peri = cv.arcLength(c, true);
    cv.approxPolyDP(c, approx, 0.015 * peri, true);
    const nPts = approx.rows;
    if (nPts >= 4 && nPts <= 30) {
      const polygon = [];
      for (let j = 0; j < nPts; j++) {
        polygon.push([
          Math.max(0, Math.min(1, approx.data32S[j * 2] / W)),
          Math.max(0, Math.min(1, approx.data32S[j * 2 + 1] / H))
        ]);
      }
      bubbles.push({
        polygon,
        bubblePolygon: polygon,
        x: x / W,
        y: y / H,
        w: w / W,
        h: h / H,
        px: x,
        py: y,
        pw: w,
        ph: h
      });
    }
    approx.delete();
  }
  contours.delete();
  bubbles.sort((a, b) => a.py !== b.py ? a.py - b.py : a.px - b.px);
  return bubbles;
}
async function buildMask(imgBuf, bubbles) {
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
  cv.adaptiveThreshold(
    grayMat,
    threshMat,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    15,
    2
  );
  grayMat.delete();
  const fullMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
  for (const b of bubbles) {
    const poly = b.bubblePolygon;
    if (!poly || poly.length < 3) continue;
    const pxCoords = poly.map(([nx, ny]) => [
      Math.max(0, Math.min(W - 1, Math.round(nx * W))),
      Math.max(0, Math.min(H - 1, Math.round(ny * H)))
    ]);
    const flat = pxCoords.flatMap(([x, y]) => [x, y]);
    const polyMask = cv.Mat.zeros(H, W, cv.CV_8UC1);
    const cmat = cv.matFromArray(pxCoords.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(cmat);
    cv.fillPoly(polyMask, vec, new cv.Scalar(255), cv.LINE_8);
    vec.delete();
    cmat.delete();
    const ink = new cv.Mat();
    cv.bitwise_and(threshMat, polyMask, ink);
    polyMask.delete();
    cv.bitwise_or(fullMask, ink, fullMask);
    ink.delete();
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
async function inpaint(imgBuf, maskData, W, H) {
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
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}
async function drawOCROverlay(imgBuf, bubbles, texts, W, H) {
  const { data } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgr = new cv.Mat();
  cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);
  mat.delete();
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const color = new cv.Scalar(0, 200, 0);
    const flat = b.polygon.flatMap(([nx, ny]) => [
      Math.round(nx * W),
      Math.round(ny * H)
    ]);
    const cmat = cv.matFromArray(b.polygon.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(cmat);
    cv.polylines(bgr, vec, true, color, 2, cv.LINE_AA, 0);
    vec.delete();
    cmat.delete();
    const lx = Math.max(4, b.px + 4);
    const ly = Math.max(16, b.py + 18);
    const txt = texts[i] ? `#${i} ${texts[i].original.slice(0, 28)}` : `#${i}`;
    cv.rectangle(bgr, new cv.Point(lx - 2, ly - 12), new cv.Point(lx + txt.length * 7, ly + 3), new cv.Scalar(0, 60, 0), -1);
    cv.putText(bgr, txt, new cv.Point(lx, ly), cv.FONT_HERSHEY_SIMPLEX, 0.38, new cv.Scalar(100, 255, 100), 1, cv.LINE_AA, false);
  }
  const rgb = new cv.Mat();
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB);
  bgr.delete();
  const raw = Buffer.from(rgb.data);
  rgb.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 5 }).toBuffer();
}
async function drawMaskOverlay(imgBuf, maskData, W, H) {
  const { data } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgr = new cv.Mat();
  cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);
  mat.delete();
  const maskMat = new cv.Mat(H, W, cv.CV_8UC1);
  maskMat.data.set(new Uint8Array(maskData));
  const red = cv.Mat.zeros(H, W, cv.CV_8UC3);
  red.setTo(new cv.Scalar(0, 0, 230));
  const binary = new cv.Mat();
  cv.threshold(maskMat, binary, 127, 255, cv.THRESH_BINARY);
  maskMat.delete();
  const redRegion = new cv.Mat();
  red.copyTo(redRegion, binary);
  binary.delete();
  red.delete();
  cv.addWeighted(bgr, 0.5, redRegion, 0.5, 0, bgr);
  redRegion.delete();
  const rgb = new cv.Mat();
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB);
  bgr.delete();
  const raw = Buffer.from(rgb.data);
  rgb.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 5 }).toBuffer();
}
async function drawFinalOverlay(inpaintedBuf, bubbles, texts, W, H) {
  const { data } = await sharp(inpaintedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgr = new cv.Mat();
  cv.cvtColor(mat, bgr, cv.COLOR_RGBA2BGR);
  mat.delete();
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const flat = b.polygon.flatMap(([nx, ny]) => [
      Math.round(nx * W),
      Math.round(ny * H)
    ]);
    const cmat = cv.matFromArray(b.polygon.length, 1, cv.CV_32SC2, flat);
    const vec = new cv.MatVector();
    vec.push_back(cmat);
    cv.polylines(bgr, vec, true, new cv.Scalar(180, 160, 0), 3, cv.LINE_AA, 0);
    vec.delete();
    cmat.delete();
    const lx = Math.max(4, b.px + 4);
    const ly = Math.max(14, b.py + b.ph / 2);
    const label = `[AR #${i}]`;
    cv.rectangle(bgr, new cv.Point(lx - 2, ly - 13), new cv.Point(lx + label.length * 8, ly + 2), new cv.Scalar(80, 60, 0), -1);
    cv.putText(bgr, label, new cv.Point(lx, ly), cv.FONT_HERSHEY_SIMPLEX, 0.42, new cv.Scalar(0, 230, 230), 1, cv.LINE_AA, false);
  }
  const rgb = new cv.Mat();
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB);
  bgr.delete();
  const raw = Buffer.from(rgb.data);
  rgb.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 5 }).toBuffer();
}
function countDark(grayBuf, W, b, thresh = 80) {
  let n = 0;
  const x2 = b.px + b.pw;
  const y2 = b.py + b.ph;
  for (let y = b.py; y < y2; y++)
    for (let x = b.px; x < x2; x++)
      if (grayBuf[y * W + x] < thresh) n++;
  return n;
}
function countMaskPx(maskData, W, b) {
  let n = 0;
  const x2 = b.px + b.pw;
  const y2 = b.py + b.ph;
  for (let y = b.py; y < y2; y++)
    for (let x = b.px; x < x2; x++)
      if (maskData[y * W + x] > 127) n++;
  return n;
}
async function processImage(cfg) {
  const { path: imgPath, outDir, label, texts } = cfg;
  mkdirSync(outDir, { recursive: true });
  console.log(`
${"\u2550".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`  ${imgPath.split("/").pop()}`);
  console.log("\u2550".repeat(60));
  const imgBuf = readFileSync(imgPath);
  const { width: W, height: H } = await sharp(imgBuf).metadata();
  console.log(`  dimensions: ${W}\xD7${H} px`);
  const origPng = await sharp(imgBuf).png().toBuffer();
  save(outDir, "01_original.png", origPng);
  console.log("\n  [1/5] Detecting speech bubbles (OpenCV white-region analysis)\u2026");
  const { data: rawRGBA } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bubbles = detectBubbles(rawRGBA, W, H);
  console.log(`  \u2713 ${bubbles.length} bubbles detected`);
  bubbles.forEach(
    (b, i) => console.log(`    #${i}  (${b.px},${b.py}) ${b.pw}\xD7${b.ph}px  area=${(b.pw * b.ph).toLocaleString()}`)
  );
  const ocrPng = await drawOCROverlay(imgBuf, bubbles, texts, W, H);
  save(outDir, "02_ocr_overlay.png", ocrPng);
  console.log("\n  [2/5] Building segmentation mask (SegmentationEngine)\u2026");
  const { maskData, W: mW, H: mH } = await buildMask(imgBuf, bubbles);
  const totalMaskPx = maskData.reduce((a, v) => a + (v > 127 ? 1 : 0), 0);
  console.log(`  \u2713 ${totalMaskPx.toLocaleString()} pixels flagged for inpainting`);
  const maskPng = await drawMaskOverlay(imgBuf, maskData, mW, mH);
  save(outDir, "03_mask.png", maskPng);
  console.log("\n  [3/5] Inpainting (OpenCV Telea FMM, radius=10)\u2026");
  const t0 = Date.now();
  const inpaintedBuf = await inpaint(imgBuf, maskData, mW, mH);
  const elapsed = Date.now() - t0;
  console.log(`  \u2713 done in ${elapsed}ms`);
  save(outDir, "04_inpainted.png", inpaintedBuf);
  const finalPng = await drawFinalOverlay(inpaintedBuf, bubbles, texts, mW, mH);
  save(outDir, "05_final.png", finalPng);
  console.log("\n  [4/5] Per-region dark-pixel statistics\u2026");
  const { data: grayBefore } = await sharp(imgBuf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { data: grayAfter } = await sharp(inpaintedBuf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const beforeArr = new Uint8Array(grayBefore);
  const afterArr = new Uint8Array(grayAfter);
  console.log("  #  \u2502 BBox (px)            \u2502 MaskPx \u2502 DarkBefore \u2502 DarkAfter \u2502 Removed");
  console.log("  \u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  let totBefore = 0, totAfter = 0, totMask = 0;
  const regionReport = [];
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    const mPx = countMaskPx(maskData, mW, b);
    const dBefore = countDark(beforeArr, mW, b);
    const dAfter = countDark(afterArr, mW, b);
    const pct = dBefore > 0 ? ((1 - dAfter / dBefore) * 100).toFixed(1) : "\u2014";
    const bbox = `(${b.px},${b.py}) ${b.pw}\xD7${b.ph}`;
    console.log(`  ${String(i).padStart(2)} \u2502 ${bbox.padEnd(20)} \u2502 ${String(mPx).padStart(6)} \u2502 ${String(dBefore).padStart(10)} \u2502 ${String(dAfter).padStart(9)} \u2502 ${pct}%`);
    totBefore += dBefore;
    totAfter += dAfter;
    totMask += mPx;
    regionReport.push({
      id: i,
      type: "speech_bubble",
      ocrBbox: { x: b.px, y: b.py, w: b.pw, h: b.ph },
      maskPixels: mPx,
      darkBefore: dBefore,
      darkAfter: dAfter,
      removedPercent: dBefore > 0 ? parseFloat(((1 - dAfter / dBefore) * 100).toFixed(1)) : null,
      originalText: texts[i]?.original ?? "",
      translatedText: texts[i]?.translated ?? ""
    });
  }
  const overallPct = totBefore > 0 ? ((1 - totAfter / totBefore) * 100).toFixed(1) : "\u2014";
  console.log("  \u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  TOTAL  maskPx=${totMask.toLocaleString()}  darkBefore=${totBefore.toLocaleString()}  darkAfter=${totAfter.toLocaleString()}  removed=${overallPct}%`);
  const report = {
    image: imgPath.split("/").pop(),
    label,
    dimensions: { width: W, height: H },
    totalMaskPixels: totMask,
    inpaintTimeMs: elapsed,
    regions: regionReport,
    summary: {
      totalDarkBefore: totBefore,
      totalDarkAfter: totAfter,
      overallRemovedPercent: parseFloat(overallPct)
    }
  };
  writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`
  \u2713 All 5 images + report.json saved to ${outDir.split("/").slice(-4).join("/")}`);
  return report;
}
async function main() {
  console.log("\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("\u2551   MangaVerse \u2014 Production CV Pipeline Proof              \u2551");
  console.log("\u2551   Exact failing images from user screenshots             \u2551");
  console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  const reports = [];
  for (const img of IMAGES) {
    const r = await processImage(img);
    reports.push(r);
  }
  console.log("\n\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("\u2551   SUMMARY                                                \u2551");
  console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  for (const r of reports) {
    console.log(`
  ${r.label}`);
    console.log(`    Bubbles processed: ${r.regions.length}`);
    console.log(`    Mask pixels:       ${r.totalMaskPixels.toLocaleString()}`);
    console.log(`    Dark px removed:   ${r.summary.overallRemovedPercent}%`);
    console.log(`    Inpaint time:      ${r.inpaintTimeMs}ms`);
    r.regions.forEach((reg) => {
      const p = reg.removedPercent ?? "\u2014";
      console.log(`    #${reg.id}  "${reg.originalText.slice(0, 40)}\u2026"  \u2192 ${p}% removed`);
    });
  }
  console.log("\n  Output locations:");
  console.log("    attached_assets/proof/user1/  \u2014 character scene");
  console.log("    attached_assets/proof/user2/  \u2014 industrial scene");
  console.log("");
}
main().catch((e) => {
  console.error("\n\u2717 FAILED:", e);
  process.exit(1);
});
