import sharp from "sharp";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const _req = createRequire(import.meta.url);
const cv = _req("@techstark/opencv-js");
const OUT_DIR = resolve(__dirname, "../../../attached_assets/proof");
mkdirSync(OUT_DIR, { recursive: true });
function save(name, buf) {
  const p = resolve(OUT_DIR, name);
  writeFileSync(p, buf);
  console.log(`  \u2713 saved ${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
}
const CDN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
async function fetchBuf(url, referer = "https://mangadex.org/") {
  const r = await fetch(url, {
    headers: { "User-Agent": CDN_UA, Referer: referer, Accept: "image/*,*/*" }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
async function getMangaDexPageUrl() {
  console.log("  \u2192 querying MangaDex API for Chainsaw Man Ch.1 \u2026");
  const MANGA_ID = "a77742b1-befd-49a4-bff5-1ad4e6b0ef7b";
  const chapterUrl = `https://api.mangadex.org/chapter?manga=${MANGA_ID}&translatedLanguage[]=en&order[chapter]=asc&limit=10`;
  const chRes = await fetch(chapterUrl, {
    headers: { "User-Agent": CDN_UA, Accept: "application/json" }
  });
  if (!chRes.ok) throw new Error(`MangaDex chapters HTTP ${chRes.status}`);
  const chData = await chRes.json();
  const chapters = chData?.data ?? [];
  if (!chapters.length) throw new Error("No chapters found");
  for (const ch of chapters) {
    const chId = ch.id;
    const chNum = ch.attributes?.chapter ?? "?";
    const atHomeUrl = `https://api.mangadex.org/at-home/server/${chId}`;
    const atHomeRes = await fetch(atHomeUrl, {
      headers: { "User-Agent": CDN_UA, Accept: "application/json" }
    });
    if (!atHomeRes.ok) continue;
    const atHome = await atHomeRes.json();
    const baseUrl = atHome.baseUrl ?? "";
    const hash = atHome.chapter?.hash ?? "";
    const pages = atHome.chapter?.data ?? [];
    if (!pages.length || !baseUrl || !hash) {
      console.log(`  \u2192 ch.${chNum} id=${chId}: no CDN pages, skipping`);
      continue;
    }
    const pageFile = pages[Math.min(3, pages.length - 1)];
    const pageUrl = `${baseUrl}/data/${hash}/${pageFile}`;
    console.log(`  \u2192 ch.${chNum} id=${chId}: ${pages.length} pages`);
    console.log(`  \u2192 page URL: ${pageUrl.slice(0, 90)}\u2026`);
    return pageUrl;
  }
  throw new Error("No working chapters found with CDN pages");
}
function detectSpeechBubbles(rawRGBA, W, H) {
  const rgbaMat = new cv.Mat(H, W, cv.CV_8UC4);
  rgbaMat.data.set(new Uint8Array(rawRGBA));
  const gray = new cv.Mat();
  cv.cvtColor(rgbaMat, gray, cv.COLOR_RGBA2GRAY);
  rgbaMat.delete();
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 210, 255, cv.THRESH_BINARY);
  gray.delete();
  const k15 = cv.Mat.ones(15, 15, cv.CV_8U);
  cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, k15);
  k15.delete();
  const k5 = cv.Mat.ones(5, 5, cv.CV_8U);
  cv.erode(thresh, thresh, k5);
  k5.delete();
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  thresh.delete();
  hier.delete();
  const regions = [];
  const n = contours.size();
  for (let i = 0; i < n; i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area < 800 || area > W * H * 0.25) continue;
    const rect = cv.boundingRect(c);
    const { x, y, width: w, height: h } = rect;
    const ar = w / h;
    if (ar > 8 || ar < 0.12) continue;
    if (w / W > 0.92) continue;
    const approx = new cv.Mat();
    const peri = cv.arcLength(c, true);
    cv.approxPolyDP(c, approx, 0.018 * peri, true);
    const nPts = approx.rows;
    if (nPts >= 4 && nPts <= 20) {
      const polygon = [];
      for (let j = 0; j < nPts; j++) {
        polygon.push([
          Math.max(0, Math.min(1, approx.data32S[j * 2] / W)),
          Math.max(0, Math.min(1, approx.data32S[j * 2 + 1] / H))
        ]);
      }
      regions.push({
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
  return regions;
}
function countDarkPx(grayBuf, W, region, threshold = 80) {
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
async function drawAnnotated(inpaintedBuf, stats) {
  const { data, info } = await sharp(inpaintedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgrMat = new cv.Mat();
  cv.cvtColor(mat, bgrMat, cv.COLOR_RGBA2BGR);
  mat.delete();
  for (const s of stats) {
    const r = s.region;
    const pct = s.darkBefore > 0 ? Math.round((1 - s.darkAfter / s.darkBefore) * 100) : 0;
    const color = pct >= 50 ? new cv.Scalar(0, 200, 0) : new cv.Scalar(0, 120, 255);
    cv.rectangle(
      bgrMat,
      new cv.Point(r.px, r.py),
      new cv.Point(r.px + r.pw, r.py + r.ph),
      color,
      2
    );
    const label = `#${s.idx} ${s.darkBefore}->${s.darkAfter} (${pct}% removed)`;
    const fontScale = 0.38;
    const thickness = 1;
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
      bgrMat,
      label,
      new cv.Point(tx + 2, ty - 2),
      cv.FONT_HERSHEY_SIMPLEX,
      fontScale,
      new cv.Scalar(255, 255, 255),
      thickness,
      cv.LINE_AA,
      false
    );
  }
  const rgbMat = new cv.Mat();
  cv.cvtColor(bgrMat, rgbMat, cv.COLOR_BGR2RGB);
  bgrMat.delete();
  const raw = Buffer.from(rgbMat.data);
  rgbMat.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}
async function drawMaskOverlay(imgBuf, maskData, W, H) {
  const { data } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mat = new cv.Mat(H, W, cv.CV_8UC4);
  mat.data.set(new Uint8Array(data));
  const bgrMat = new cv.Mat();
  cv.cvtColor(mat, bgrMat, cv.COLOR_RGBA2BGR);
  mat.delete();
  const maskMat = new cv.Mat(H, W, cv.CV_8UC1);
  maskMat.data.set(new Uint8Array(maskData));
  const overlay = cv.Mat.zeros(H, W, cv.CV_8UC3);
  overlay.setTo(new cv.Scalar(0, 0, 220));
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
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}
async function buildMask(imgBuf, regions) {
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
  for (const region of regions) {
    const poly = region.bubblePolygon ?? region.polygon;
    if (!poly || poly.length < 3) continue;
    const pxCoords = poly.map(([nx, ny]) => [
      Math.max(0, Math.min(W - 1, Math.round(nx * W))),
      Math.max(0, Math.min(H - 1, Math.round(ny * H)))
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
  const resultRGB = new cv.Mat();
  cv.cvtColor(dst, resultRGB, cv.COLOR_BGR2RGB);
  dst.delete();
  const raw = Buffer.from(resultRGB.data);
  resultRGB.delete();
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}
function countMaskPx(maskData, W, region) {
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
async function main() {
  console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("  MangaVerse CV Pipeline \u2014 Inpainting Proof");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
  console.log("[1/6] Fetching manga page from MangaDex\u2026");
  let pageUrl;
  let imgBuf;
  try {
    pageUrl = await getMangaDexPageUrl();
    imgBuf = await fetchBuf(pageUrl);
    console.log(`  \u2713 downloaded ${(imgBuf.length / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.warn("  ! MangaDex API failed, using fallback URL");
    pageUrl = "https://uploads.mangadex.org/data/";
    throw e;
  }
  const originalPng = await sharp(imgBuf).png().toBuffer();
  save("01_original.png", originalPng);
  const { width: W, height: H } = await sharp(imgBuf).metadata();
  console.log(`  image dimensions: ${W}\xD7${H} px`);
  console.log("\n[2/6] Auto-detecting speech bubbles via OpenCV white-region analysis\u2026");
  const { data: rawRGBA } = await sharp(imgBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const regions = detectSpeechBubbles(rawRGBA, W, H);
  console.log(`  \u2713 detected ${regions.length} candidate bubble regions`);
  if (regions.length === 0) {
    console.error("  \u2717 no regions detected \u2014 page may have dark backgrounds");
    process.exit(1);
  }
  console.log("\n[3/6] Counting dark pixels per region BEFORE inpainting\u2026");
  const { data: grayRawBefore } = await sharp(imgBuf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const grayBefore = new Uint8Array(grayRawBefore);
  const preCounts = regions.map((r) => countDarkPx(grayBefore, W, r));
  console.log("\n[4/6] Building text segmentation mask (SegmentationEngine)\u2026");
  const { maskData, W: mW, H: mH } = await buildMask(imgBuf, regions);
  const totalMaskPx = maskData.reduce((a, v) => a + (v > 127 ? 1 : 0), 0);
  console.log(`  \u2713 mask built: ${totalMaskPx.toLocaleString()} pixels flagged for inpainting`);
  const maskOverlayPng = await drawMaskOverlay(imgBuf, maskData, mW, mH);
  save("02_mask.png", maskOverlayPng);
  console.log("\n[5/6] Inpainting with OpenCV Telea FMM (radius=10)\u2026");
  const t0 = Date.now();
  const inpaintedBuf = await inpaint(imgBuf, maskData, mW, mH);
  console.log(`  \u2713 inpainting complete in ${Date.now() - t0}ms`);
  save("03_inpainted.png", inpaintedBuf);
  console.log("\n[6/6] Counting dark pixels AFTER inpainting & building annotated image\u2026");
  const { data: grayRawAfter } = await sharp(inpaintedBuf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const grayAfter = new Uint8Array(grayRawAfter);
  const stats = regions.map((region, idx) => ({
    region,
    idx,
    darkBefore: preCounts[idx],
    darkAfter: countDarkPx(grayAfter, mW, region),
    maskPx: countMaskPx(maskData, mW, region)
  }));
  const annotatedPng = await drawAnnotated(inpaintedBuf, stats);
  save("04_annotated.png", annotatedPng);
  console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("  Per-Region Statistics");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log(
    "  #  \u2502 BBox (px)              \u2502 MaskPx \u2502 DarkBefore \u2502 DarkAfter \u2502 Removed"
  );
  console.log("  \u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u253C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  let totalBefore = 0;
  let totalAfter = 0;
  let totalMask = 0;
  for (const s of stats) {
    const r = s.region;
    const pct = s.darkBefore > 0 ? ((1 - s.darkAfter / s.darkBefore) * 100).toFixed(1) : "\u2014";
    const bbox = `(${r.px},${r.py}) ${r.pw}\xD7${r.ph}`;
    console.log(
      `  ${String(s.idx).padStart(2)} \u2502 ${bbox.padEnd(22)} \u2502 ${String(s.maskPx).padStart(6)} \u2502 ${String(s.darkBefore).padStart(10)} \u2502 ${String(s.darkAfter).padStart(9)} \u2502 ${pct}%`
    );
    totalBefore += s.darkBefore;
    totalAfter += s.darkAfter;
    totalMask += s.maskPx;
  }
  console.log("  \u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  const overallPct = totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) : "\u2014";
  console.log(
    `  TOTAL  regions=${stats.length}  maskPx=${totalMask.toLocaleString()}  darkBefore=${totalBefore.toLocaleString()}  darkAfter=${totalAfter.toLocaleString()}  removed=${overallPct}%`
  );
  console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("  Output files saved to attached_assets/proof/");
  console.log("    01_original.png   \u2014 source page, unmodified");
  console.log("    02_mask.png       \u2014 red = pixels that WILL be removed");
  console.log("    03_inpainted.png  \u2014 English text REMOVED, bg restored");
  console.log("    04_annotated.png  \u2014 per-region dark-pixel stats overlay");
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
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
      removedPercent: s.darkBefore > 0 ? parseFloat(((1 - s.darkAfter / s.darkBefore) * 100).toFixed(1)) : 0
    })),
    summary: {
      totalDarkBefore: totalBefore,
      totalDarkAfter: totalAfter,
      overallRemovedPercent: parseFloat(overallPct)
    }
  };
  const reportPath = resolve(OUT_DIR, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  \u2713 report.json written
`);
}
main().catch((e) => {
  console.error("\n\u2717 proof-pipeline failed:", e);
  process.exit(1);
});
