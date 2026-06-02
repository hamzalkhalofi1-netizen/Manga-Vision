/**
 * GET  /api/debug-pipeline  — serves the browser debug UI
 * POST /api/debug-pipeline  — runs the full 8-stage diagnostic and returns JSON
 *
 * POST body:
 *   imageUrl  : string         CDN URL of the manga page
 *   imageData : string         base64 PNG/JPEG (alternative to imageUrl)
 *   regions   : GeminiRegion[] Paste the "regions" array from Gemini OCR output
 *
 * POST response:
 *   stages  : { s1_original, s2_ocr, s3_classification, s4_bubble,
 *               s5_segmentation, s6_inpainting, s7_renderer, s8_final }
 *             Each value is a base64 PNG.
 *   regions : per-region report with classification, polygons, render rect
 *   summary : counts by TextClass
 *   timing  : ms per stage
 */

import { Router } from "express";
import { buildTextMasks } from "../cv/SegmentationEngine.js";
import { inpaintImage } from "../cv/InpaintingEngine.js";
import { refineBubblePolygons } from "../cv/BubbleDetectionEngine.js";
import {
  drawOCROverlay,
  drawClassificationOverlay,
  drawBubbleOverlay,
  drawMaskOverlay,
  drawRendererOverlay,
  CLASS_BGR,
} from "../cv/DebugRenderer.js";

const router = Router();

// ── Classification (self-contained, mirrors TextClassificationEngine.ts) ──────

type TextClass =
  | "speech_bubble" | "narration_box" | "sfx"
  | "chapter_title" | "credits"  | "watermark"
  | "ui_text"       | "unknown";

interface Classification {
  textClass: TextClass;
  confidence: number;
  shouldTranslate: boolean;
  shouldInpaint: boolean;
  shouldRender: boolean;
  reason: string;
}

const POLICY: Record<TextClass, readonly [boolean, boolean, boolean]> = {
  speech_bubble: [true,  true,  true],
  narration_box: [true,  true,  true],
  sfx:           [false, true,  false],
  ui_text:       [true,  true,  true],
  chapter_title: [false, false, false],
  credits:       [false, false, false],
  watermark:     [false, false, false],
  unknown:       [false, false, false],
};

const GEMINI_MAP: Record<string, TextClass> = {
  speech: "speech_bubble", thought: "speech_bubble",
  narration: "narration_box", sfx: "sfx", sign: "ui_text",
  title: "chapter_title", credits: "credits", watermark: "watermark",
  label: "ui_text", caption: "narration_box", whisper: "speech_bubble",
};

function mk(cls: TextClass, conf: number, reason: string): Classification {
  const [tr, inp, rnd] = POLICY[cls];
  return { textClass: cls, confidence: conf, shouldTranslate: tr, shouldInpaint: inp, shouldRender: rnd, reason };
}

function classifyRegion(r: {
  original?: string; translated?: string;
  x: number; y: number; w: number; h: number; type?: string;
}): Classification {
  const text = (r.original ?? r.translated ?? "").trim();
  const { x, y, w, h, type: gt = "" } = r;

  if (/https?:\/\/|www\.|\.com[\s/]|\.net[\s/]|\.org[\s/]/i.test(text))
    return mk("watermark", 0.97, "url-pattern");
  if (/©|\(c\)|copyright|scanlat|translat|typeset|cleaned|proofreader/i.test(text))
    return mk("credits", 0.92, "credits-keyword");
  if (/^ch(apter|\.)\s*\d+/i.test(text) || /^vol(ume|\.)?\s*\d+/i.test(text) || /^episode\s*\d+/i.test(text))
    return mk("chapter_title", 0.88, "chapter-pattern");

  const mapped = GEMINI_MAP[gt.toLowerCase()];
  if (mapped) return mk(mapped, 0.82, `gemini:${gt}`);

  if (w > 0.72 && y < 0.10 && h < 0.12)
    return mk("chapter_title", 0.75, "full-width-top");
  if (w > 0.72 && y + h > 0.92 && h < 0.10)
    return mk("credits", 0.70, "full-width-bottom");
  if (w * h < 0.0008)
    return mk("unknown", 0.60, "too-small");

  return mk("speech_bubble", 0.45, "fallback-speech");
}

// ── Image fetch ───────────────────────────────────────────────────────────────

const CDN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

function getCdnReferer(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("mangafire") || u.includes("b-cdn.net")) return "https://mangafire.to/";
  if (u.includes("asura")) return "https://asurascans.com/";
  if (u.includes("bato")) return "https://bato.to/";
  if (u.includes("comick")) return "https://comick.io/";
  if (u.includes("webtoon") || u.includes("naver")) return "https://www.webtoons.com/";
  if (u.includes("manganato")) return "https://chapmanganato.to/";
  return "https://mangadex.org/";
}

async function fetchImage(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent": CDN_UA,
      "Referer": getCdnReferer(imageUrl),
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`CDN fetch ${res.status}: ${imageUrl.slice(0, 80)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Inline HTML debug page ────────────────────────────────────────────────────

const DEBUG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MangaVerse — Pipeline Diagnostic</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;display:flex;align-items:center;gap:12px}
.hdr h1{font-size:18px;font-weight:600}
.badge{font-size:11px;background:#1f6feb;color:#fff;padding:2px 8px;border-radius:12px}
.body{padding:24px;max-width:1400px;margin:0 auto}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:20px}
.card h2{font-size:14px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px}
label{display:block;font-size:13px;color:#8b949e;margin-bottom:6px}
input[type=text],textarea{width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:13px;padding:10px 12px;font-family:monospace;outline:none;transition:border .2s}
input[type=text]:focus,textarea:focus{border-color:#1f6feb}
textarea{height:120px;resize:vertical}
.field{margin-bottom:14px}
.btn{background:#238636;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;transition:background .2s}
.btn:hover{background:#2ea043}
.btn:disabled{background:#21262d;color:#6e7681;cursor:not-allowed}
.err{background:#3d1218;border:1px solid #f85149;border-radius:6px;padding:12px;color:#f85149;font-size:13px;margin-top:12px;display:none}
#spinner{display:none;align-items:center;gap:10px;color:#8b949e;font-size:13px;margin-top:12px}
.spin{width:16px;height:16px;border:2px solid #30363d;border-top-color:#1f6feb;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#results{display:none}
.stages-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
@media(min-width:900px){.stages-grid{grid-template-columns:repeat(4,1fr)}}
.stage-card{background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden}
.stage-hdr{background:#161b22;padding:8px 12px;border-bottom:1px solid #30363d}
.stage-hdr .snum{font-size:11px;color:#1f6feb;font-weight:700;margin-bottom:2px}
.stage-hdr .sname{font-size:12px;font-weight:600;color:#e6edf3}
.stage-hdr .sdesc{font-size:11px;color:#6e7681;margin-top:1px}
.stage-card img{width:100%;display:block;cursor:zoom-in}
.stage-card img:hover{opacity:.9}
.stats-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.stat-box{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;text-align:center}
.stat-num{font-size:28px;font-weight:700;line-height:1}
.stat-lbl{font-size:11px;color:#6e7681;margin-top:4px}
.cls-speech{color:#3fb950}
.cls-narration{color:#58a6ff}
.cls-sfx{color:#e3b341}
.cls-ui{color:#56d364}
.cls-title{color:#f85149}
.cls-credits{color:#bc8cff}
.cls-watermark{color:#ff7b72}
.cls-unknown{color:#6e7681}
.cls-render{color:#3fb950}
.cls-skip{color:#f85149}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 10px;background:#21262d;color:#8b949e;font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #30363d;white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid #21262d;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#161b22}
.mono{font-family:monospace;font-size:11px;color:#6e7681}
.tag{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600;margin:1px}
.tag-render{background:#1a4423;color:#3fb950;border:1px solid #238636}
.tag-skip{background:#3d1218;color:#f85149;border:1px solid #6e2226}
.tag-inpaint{background:#1c2a3a;color:#58a6ff;border:1px solid #1f6feb}
.legend{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.litem{display:flex;align-items:center;gap:5px;font-size:11px;color:#8b949e}
.ldot{width:10px;height:10px;border-radius:50%}
.timing-row{display:flex;flex-wrap:wrap;gap:16px}
.timing-item{font-size:12px;color:#8b949e}
.timing-item span{color:#e6edf3;font-weight:600}
</style>
</head>
<body>
<div class="hdr">
  <div>
    <h1>MangaVerse — Pipeline Diagnostic</h1>
  </div>
  <span class="badge">8-Stage CV Debug</span>
</div>
<div class="body">

<div class="card">
  <h2>Input</h2>
  <div class="field">
    <label>Manga Page Image URL (CDN URL from the app)</label>
    <input type="text" id="imageUrl" placeholder="https://cdn.mangadex.org/data/.../0001.jpg">
  </div>
  <div class="field">
    <label>Gemini OCR Regions JSON — paste the <code style="color:#1f6feb">"regions"</code> array from a translation result</label>
    <textarea id="regionsJson" placeholder='[
  {
    "original": "...",
    "translated": "...",
    "x": 0.10, "y": 0.05, "w": 0.32, "h": 0.13,
    "type": "speech",
    "bgColor": "#ffffff", "textColor": "#000000",
    "polygon": [[0.10,0.05],[0.42,0.05],[0.42,0.18],[0.10,0.18]],
    "bubblePolygon": [[0.04,0.01],[0.47,0.01],[0.49,0.21],[0.03,0.21]]
  }
]'></textarea>
  </div>
  <button class="btn" id="runBtn">▶ Run Diagnostic</button>
  <div id="spinner"><div class="spin"></div> Running pipeline… this takes 5–15 seconds</div>
  <div class="err" id="errBox"></div>
</div>

<div id="results">

<div class="card">
  <h2>Stage Images</h2>
  <div class="legend" id="legend">
    <div class="litem"><div class="ldot" style="background:#3fb950"></div>speech_bubble</div>
    <div class="litem"><div class="ldot" style="background:#58a6ff"></div>narration_box</div>
    <div class="litem"><div class="ldot" style="background:#e3b341"></div>sfx</div>
    <div class="litem"><div class="ldot" style="background:#56d364"></div>ui_text</div>
    <div class="litem"><div class="ldot" style="background:#f85149"></div>chapter_title</div>
    <div class="litem"><div class="ldot" style="background:#bc8cff"></div>credits</div>
    <div class="litem"><div class="ldot" style="background:#ff7b72"></div>watermark</div>
    <div class="litem"><div class="ldot" style="background:#6e7681"></div>unknown</div>
    <div class="litem"><div class="ldot" style="background:#fff;border:1px solid #6e7681"></div>OCR polygon</div>
    <div class="litem"><div class="ldot" style="background:#e3b341"></div>Gemini bubble polygon</div>
  </div>
  <div class="stages-grid" id="stagesGrid"></div>
</div>

<div class="card">
  <h2>Summary Statistics</h2>
  <div class="stats-row" id="statsRow"></div>
  <div style="margin-top:14px">
    <div class="timing-row" id="timingRow"></div>
  </div>
</div>

<div class="card">
  <h2>Per-Region Analysis</h2>
  <div style="overflow-x:auto">
    <table id="regionTable">
      <thead>
        <tr>
          <th>#</th>
          <th>Original</th>
          <th>Translated</th>
          <th>Gemini type</th>
          <th>Class</th>
          <th>Conf</th>
          <th>Reason</th>
          <th>Flags</th>
          <th>OCR polygon</th>
          <th>Bubble polygon</th>
          <th>CV refined</th>
          <th>Render rect</th>
        </tr>
      </thead>
      <tbody id="regionTbody"></tbody>
    </table>
  </div>
</div>

</div><!-- /results -->
</div><!-- /body -->

<script>
const STAGE_META = [
  { key:"s1_original",       num:"S1", name:"Original",              desc:"Source image — no modifications" },
  { key:"s2_ocr",            num:"S2", name:"OCR Overlay",           desc:"All Gemini regions, colored by raw type" },
  { key:"s3_classification", num:"S3", name:"Classification",        desc:"Regions colored by TextClass — titles/credits in red" },
  { key:"s4_bubble",         num:"S4", name:"Bubble Detection",      desc:"White=OCR, Yellow=Gemini, Green=CV-refined contour" },
  { key:"s5_segmentation",   num:"S5", name:"Segmentation Mask",     desc:"Red overlay = ink pixels that will be inpainted" },
  { key:"s6_inpainting",     num:"S6", name:"Inpainting Result",     desc:"OpenCV Telea — original text removed, background restored" },
  { key:"s7_renderer",       num:"S7", name:"Renderer Overlay",      desc:"Green=rendered Arabic region, Red=skipped" },
  { key:"s8_final",          num:"S8", name:"Final Page",            desc:"Inpainted image (Arabic text added on mobile)" },
];

const CLASS_CSS = {
  speech_bubble:"cls-speech", narration_box:"cls-narration",
  sfx:"cls-sfx", ui_text:"cls-ui", chapter_title:"cls-title",
  credits:"cls-credits", watermark:"cls-watermark", unknown:"cls-unknown",
};

document.getElementById("runBtn").addEventListener("click", runDiagnostic);

async function runDiagnostic() {
  const imageUrl   = document.getElementById("imageUrl").value.trim();
  const regionsRaw = document.getElementById("regionsJson").value.trim();

  const errBox  = document.getElementById("errBox");
  const spinner = document.getElementById("spinner");
  const btn     = document.getElementById("runBtn");
  errBox.style.display = "none";

  if (!imageUrl && !regionsRaw) {
    errBox.textContent = "Provide at least an image URL.";
    errBox.style.display = "block";
    return;
  }

  let regions = [];
  if (regionsRaw) {
    try { regions = JSON.parse(regionsRaw); }
    catch(e) {
      errBox.textContent = "Regions JSON parse error: " + e.message;
      errBox.style.display = "block";
      return;
    }
  }

  btn.disabled = true;
  spinner.style.display = "flex";
  document.getElementById("results").style.display = "none";

  try {
    const res = await fetch("/api/debug-pipeline", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ imageUrl: imageUrl || undefined, regions }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Server error " + res.status);
    renderResults(data);
  } catch(e) {
    errBox.textContent = e.message;
    errBox.style.display = "block";
  } finally {
    btn.disabled = false;
    spinner.style.display = "none";
  }
}

function renderResults(data) {
  // Stages
  const grid = document.getElementById("stagesGrid");
  grid.innerHTML = "";
  for (const s of STAGE_META) {
    const b64 = data.stages[s.key];
    const card = document.createElement("div");
    card.className = "stage-card";
    card.innerHTML = \`
      <div class="stage-hdr">
        <div class="snum">\${s.num}</div>
        <div class="sname">\${s.name}</div>
        <div class="sdesc">\${s.desc}</div>
      </div>
      <img src="data:image/png;base64,\${b64}" alt="\${s.name}"
           onclick="window.open(this.src,'_blank')" title="Click to open full size">\`;
    grid.appendChild(card);
  }

  // Summary stats
  const sm = data.summary;
  const statsRow = document.getElementById("statsRow");
  const statDefs = [
    { key:"total",         label:"Total Regions",    css:"" },
    { key:"speech_bubble", label:"Speech Bubbles",   css:"cls-speech" },
    { key:"narration_box", label:"Narration Boxes",  css:"cls-narration" },
    { key:"sfx",           label:"SFX",              css:"cls-sfx" },
    { key:"ui_text",       label:"UI / Signs",       css:"cls-ui" },
    { key:"chapter_title", label:"Chapter Titles",   css:"cls-title" },
    { key:"credits",       label:"Credits",          css:"cls-credits" },
    { key:"watermark",     label:"Watermarks",       css:"cls-watermark" },
    { key:"unknown",       label:"Unknown",          css:"cls-unknown" },
    { key:"inpainted",     label:"Inpainted",        css:"cls-render" },
    { key:"rendered",      label:"Rendered",         css:"cls-render" },
    { key:"skipped",       label:"Skipped",          css:"cls-skip" },
  ];
  statsRow.innerHTML = statDefs.map(d => \`
    <div class="stat-box">
      <div class="stat-num \${d.css}">\${sm[d.key] ?? 0}</div>
      <div class="stat-lbl">\${d.label}</div>
    </div>\`).join("");

  // Timing
  const t = data.timing || {};
  const timingRow = document.getElementById("timingRow");
  timingRow.innerHTML = Object.entries(t).map(([k,v]) =>
    \`<div class="timing-item">\${k}: <span>\${v}ms</span></div>\`
  ).join("");

  // Per-region table
  const tbody = document.getElementById("regionTbody");
  tbody.innerHTML = (data.regions || []).map(r => {
    const cls = r.textClass || "unknown";
    const cssCls = CLASS_CSS[cls] || "";
    const flags = [
      r.shouldRender  ? '<span class="tag tag-render">RENDER</span>'  : '<span class="tag tag-skip">NO-RENDER</span>',
      r.shouldInpaint ? '<span class="tag tag-inpaint">INPAINT</span>' : '',
      r.shouldTranslate ? '' : '',
    ].join("");

    function fmtPoly(pts) {
      if (!pts || !pts.length) return '<span class="mono">—</span>';
      return '<span class="mono">'+pts.length+'pts</span>';
    }
    const rr = r.renderRect;
    const rrStr = rr ? \`<span class="mono">(\${rr.x.toFixed(2)},\${rr.y.toFixed(2)}) \${rr.w.toFixed(2)}×\${rr.h.toFixed(2)}</span>\` : '—';

    return \`<tr>
      <td><b>#\${r.index}</b></td>
      <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${esc(r.originalText)}">\${esc(r.originalText.slice(0,40))}</td>
      <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl" title="\${esc(r.translatedText)}">\${esc(r.translatedText.slice(0,40))}</td>
      <td><span class="mono">\${esc(r.detectedType)}</span></td>
      <td class="\${cssCls}" style="font-weight:600;white-space:nowrap">\${cls}</td>
      <td><span class="mono">\${(r.confidence*100).toFixed(0)}%</span></td>
      <td><span class="mono" style="color:#6e7681">\${esc(r.reason)}</span></td>
      <td>\${flags}</td>
      <td>\${fmtPoly(r.ocrPolygon)}</td>
      <td>\${fmtPoly(r.bubblePolygon)}</td>
      <td>\${fmtPoly(r.refinedBubblePolygon)}</td>
      <td>\${rrStr}</td>
    </tr>\`;
  }).join("");

  document.getElementById("results").style.display = "block";
  document.getElementById("results").scrollIntoView({ behavior:"smooth" });
}

function esc(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}
</script>
</body>
</html>`;

// ── Route handlers ────────────────────────────────────────────────────────────

router.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(DEBUG_HTML);
});

interface GeminiRegion {
  original?: string;
  translated?: string;
  x: number; y: number; w: number; h: number;
  type?: string;
  bgColor?: string;
  textColor?: string;
  polygon?: [number, number][];
  bubblePolygon?: [number, number][];
  speaker?: string | null;
  emphasis?: boolean;
}

router.post("/", async (req, res) => {
  const { imageUrl, imageData, regions = [] } = req.body as {
    imageUrl?: string;
    imageData?: string;
    regions: GeminiRegion[];
  };

  if (!imageUrl && !imageData) {
    res.status(400).json({ error: "imageUrl or imageData is required" });
    return;
  }

  const T = { total: Date.now(), fetch: 0, classify: 0, segment: 0, bubble: 0, inpaint: 0, annotate: 0 };

  let imgBuf: Buffer;
  try {
    const t0 = Date.now();
    imgBuf = imageUrl ? await fetchImage(imageUrl) : Buffer.from(imageData!, "base64");
    T.fetch = Date.now() - t0;
  } catch (err: unknown) {
    res.status(502).json({ error: `Image fetch failed: ${(err as Error).message}` });
    return;
  }

  try {
    // ── Classify all regions ──────────────────────────────────────────────────
    const t1 = Date.now();
    const classified = regions.map((r, i) => ({
      ...r,
      index: i,
      classification: classifyRegion(r),
    }));
    T.classify = Date.now() - t1;

    const inpaintTargets = classified.filter((r) => r.classification.shouldInpaint);
    const renderTargets  = classified.filter((r) => r.classification.shouldRender);

    const ocrRegions = inpaintTargets.map((r) => ({
      polygon: r.polygon ?? [
        [r.x, r.y], [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
      ] as [number, number][],
      bubblePolygon: r.bubblePolygon,
      x: r.x, y: r.y, w: r.w, h: r.h,
    }));

    // ── Stage 5: Segmentation ─────────────────────────────────────────────────
    const t2 = Date.now();
    let maskData: Buffer | null = null;
    let imgW = 0, imgH = 0;

    if (ocrRegions.length > 0) {
      const seg = await buildTextMasks(imgBuf, ocrRegions);
      maskData = seg.maskData;
      imgW = seg.width;
      imgH = seg.height;
    }
    T.segment = Date.now() - t2;

    // ── Stage 4: Bubble refinement ────────────────────────────────────────────
    const t3 = Date.now();
    const refined = ocrRegions.length > 0 ? await refineBubblePolygons(imgBuf, ocrRegions) : [];
    T.bubble = Date.now() - t3;

    // Re-index refined regions back to original indices
    const refinedByOriginalIdx = new Map<number, typeof refined[number]>();
    inpaintTargets.forEach((r, localIdx) => {
      if (refined[localIdx]) refinedByOriginalIdx.set(r.index, refined[localIdx]);
    });

    // ── Stage 6: Inpainting ───────────────────────────────────────────────────
    const t4 = Date.now();
    let inpaintedBuf: Buffer = imgBuf;
    if (maskData && ocrRegions.length > 0) {
      const { imageBuffer } = await inpaintImage(imgBuf, maskData, imgW, imgH);
      inpaintedBuf = imageBuffer;
    }
    T.inpaint = Date.now() - t4;

    // ── Draw stage annotations ────────────────────────────────────────────────
    const t5 = Date.now();

    const allAnnotated = classified.map((r) => ({
      ...r,
      textClass: r.classification.textClass,
      shouldRender: r.classification.shouldRender,
      refinedBubblePolygon: refinedByOriginalIdx.get(r.index)?.refinedBubblePolygon,
    }));

    const refinedForDraw = inpaintTargets.map((r, li) => ({
      ...r,
      index: r.index,
      textClass: r.classification.textClass,
      refinedBubblePolygon: refined[li]?.refinedBubblePolygon,
    }));

    const [s2, s3, s4, s5, s7] = await Promise.all([
      drawOCROverlay(imgBuf, classified),
      drawClassificationOverlay(imgBuf, allAnnotated),
      drawBubbleOverlay(imgBuf, refinedForDraw),
      maskData ? drawMaskOverlay(imgBuf, maskData, imgW, imgH) : Promise.resolve(imgBuf),
      drawRendererOverlay(inpaintedBuf, allAnnotated, refinedForDraw),
    ]);

    T.annotate = Date.now() - t5;

    // ── Per-region report ─────────────────────────────────────────────────────
    const regionReport = classified.map((r) => {
      const rv = refinedByOriginalIdx.get(r.index);
      const cls = r.classification;
      return {
        index: r.index,
        originalText:   r.original   ?? "",
        translatedText: r.translated ?? "",
        detectedType:   r.type       ?? "",
        textClass:      cls.textClass,
        confidence:     cls.confidence,
        reason:         cls.reason,
        shouldTranslate: cls.shouldTranslate,
        shouldInpaint:   cls.shouldInpaint,
        shouldRender:    cls.shouldRender,
        ocrPolygon:    r.polygon     ?? null,
        bubblePolygon: r.bubblePolygon ?? null,
        refinedBubblePolygon: rv?.refinedBubblePolygon ?? null,
        renderRect: { x: r.x, y: r.y, w: r.w, h: r.h },
      };
    });

    // ── Summary statistics ────────────────────────────────────────────────────
    const counts: Record<string, number> = {
      total: 0, speech_bubble: 0, narration_box: 0, sfx: 0, ui_text: 0,
      chapter_title: 0, credits: 0, watermark: 0, unknown: 0,
      inpainted: 0, rendered: 0, skipped: 0,
    };
    for (const r of classified) {
      counts.total++;
      counts[r.classification.textClass] = (counts[r.classification.textClass] ?? 0) + 1;
      if (r.classification.shouldInpaint) counts.inpainted++;
      if (r.classification.shouldRender)  counts.rendered++;
      else counts.skipped++;
    }

    const totalMs = Date.now() - T.total;
    const timing = {
      fetchMs:    T.fetch,
      classifyMs: T.classify,
      segmentMs:  T.segment,
      bubbleMs:   T.bubble,
      inpaintMs:  T.inpaint,
      annotateMs: T.annotate,
      totalMs,
    };

    res.json({
      stages: {
        s1_original:       imgBuf.toString("base64"),
        s2_ocr:            s2.toString("base64"),
        s3_classification: s3.toString("base64"),
        s4_bubble:         s4.toString("base64"),
        s5_segmentation:   s5.toString("base64"),
        s6_inpainting:     inpaintedBuf.toString("base64"),
        s7_renderer:       s7.toString("base64"),
        s8_final:          inpaintedBuf.toString("base64"),
      },
      regions: regionReport,
      summary: counts,
      timing,
      imageSize: { width: imgW || 0, height: imgH || 0 },
    });

  } catch (err: unknown) {
    res.status(500).json({ error: `Diagnostic failed: ${(err as Error).message}` });
  }
});

export default router;
