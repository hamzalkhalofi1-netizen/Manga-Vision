/**
 * Focused diagnostic — targets a single chapter with real dialogue,
 * tests multiple page types, retries Gemini on rate-limit.
 *
 * node diagnostic-focused.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY not set");

const OUT = '/home/runner/workspace/diagnostic-output';
mkdirSync(OUT, { recursive: true });

const CDN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
const MD_UA  = 'MangaVerse-Diagnostic/1.0';

// Keep diagnostics aligned with the production model. Never retry a model that
// the application has explicitly retired.
const MODELS = ['gemini-2.5-flash'];

const PROMPT = `You are a professional manga OCR and translation engine.

Analyze this manga page. For EVERY piece of visible text:
1. polygon: tight 4-point quadrilateral around text glyphs only [normalized 0-1]
2. bubblePolygon: 4-8 points tracing the full speech bubble outline [normalized 0-1]
3. x, y, w, h: bounding box [normalized 0-1]
4. bgColor / textColor: hex colors
5. type: "speech" | "thought" | "sfx" | "sign" | "narration" | "title" | "credits" | "watermark"
6. translated: Arabic translation (natural, emotionally vivid)

Return ONLY valid JSON (no markdown, no backticks):
{"found":true,"regions":[{"original":"...","translated":"...","polygon":[[x,y],[x,y],[x,y],[x,y]],"bubblePolygon":[[x,y],...],"x":0.1,"y":0.05,"w":0.32,"h":0.13,"type":"speech","bgColor":"#ffffff","textColor":"#000000","speaker":null,"emphasis":false}],"summary":"one line description"}

If truly no text visible: {"found":false,"regions":[],"summary":"No text on page"}`;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchB64(url) {
  const r = await fetch(url, {
    headers: { 'Referer': 'https://mangadex.org/', 'User-Agent': CDN_UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Image ${r.status}: ${url.slice(0, 70)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  return { base64: buf.toString('base64'), mimeType: mime, sizeKB: Math.round(buf.length / 1024) };
}

async function geminiOCR(imageUrl, attempt = 0) {
  const model = MODELS[Math.min(attempt, MODELS.length - 1)];
  const { base64, mimeType, sizeKB } = await fetchB64(imageUrl);
  console.log(`    image: ${sizeKB}KB ${mimeType} | model: ${model}`);

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: PROMPT },
        ]}],
        generationConfig: { maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(90000),
    }
  );

  const gd = await r.json();

  // Rate limit → retry with backoff + next model
  if (gd.error) {
    const msg = gd.error.message || '';
    const isRetryable = /demand|quota|rate|503|overload/i.test(msg) || r.status === 429 || r.status === 503;
    if (isRetryable && attempt < 4) {
      const delay = [8000, 15000, 25000, 40000][attempt] || 40000;
      const nextModel = MODELS[Math.min(attempt + 1, MODELS.length - 1)];
      console.log(`    rate limited (attempt ${attempt+1}), retrying in ${delay/1000}s with ${nextModel}...`);
      await sleep(delay);
      return geminiOCR(imageUrl, attempt + 1);
    }
    throw new Error(`Gemini error: ${msg}`);
  }

  const raw = gd.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : { found: false, regions: [] }; }
    catch { parsed = { found: false, regions: [] }; }
  }

  const regions = (parsed.regions || []).filter(r => typeof r.x === 'number');
  return { regions, found: parsed.found !== false, summary: parsed.summary || '', model };
}

async function runDiag(imageUrl, regions) {
  const r = await fetch('http://localhost:3000/api/debug-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, regions }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`debug-pipeline ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

function saveDiag(d, prefix) {
  const dir = join(OUT, prefix);
  mkdirSync(dir, { recursive: true });
  for (const [k, b64] of Object.entries(d.stages || {})) {
    writeFileSync(join(dir, `${k}.png`), Buffer.from(b64, 'base64'));
  }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(
    { regions: d.regions, summary: d.summary, timing: d.timing, imageSize: d.imageSize }, null, 2
  ));
  return dir;
}

// ── Per-region failure analysis ───────────────────────────────────────────────

function analyzeRegion(r) {
  const issues = [];
  const type = (r.detectedType || '').toLowerCase();
  const cls  = r.textClass || 'unknown';

  // Filtered types that reached the renderer
  if (['title', 'chapter_title'].includes(type) && r.shouldRender)
    issues.push({ stage: 'Classification', sev: 'HIGH', msg: `type="${type}" → class="${cls}" → shouldRender=true (should be false)` });

  if (type === 'credits' && r.shouldRender)
    issues.push({ stage: 'Classification', sev: 'HIGH', msg: `credits not filtered out → class="${cls}"` });

  if (type === 'watermark' && r.shouldRender)
    issues.push({ stage: 'Classification', sev: 'HIGH', msg: `watermark not filtered → class="${cls}"` });

  // Dialogue incorrectly blocked
  if (['speech', 'thought', 'narration'].includes(type) && !r.shouldRender)
    issues.push({ stage: 'Classification', sev: 'HIGH', msg: `type="${type}" blocked → shouldRender=false reason="${r.reason}"` });

  // No CV bubble refinement
  if (r.shouldRender && !r.refinedBubblePolygon)
    issues.push({ stage: 'BubbleDetection', sev: 'MEDIUM', msg: `No CV contour — falling back to ${r.bubblePolygon ? 'Gemini polygon' : 'OCR bbox'}` });

  // Empty translated text on a render-eligible region
  if (r.shouldRender && !r.translatedText?.trim())
    issues.push({ stage: 'OCR', sev: 'HIGH', msg: `shouldRender=true but translatedText is empty` });

  // Region too small for Arabic
  if (r.shouldRender && r.renderRect) {
    const a = r.renderRect.w * r.renderRect.h;
    if (a < 0.002)
      issues.push({ stage: 'Layout', sev: 'MEDIUM', msg: `Bubble area ${(a*100).toFixed(2)}% — too small for Arabic text` });
  }

  // Unknown type with fallback classification
  if (r.reason === 'fallback-speech')
    issues.push({ stage: 'Classification', sev: 'LOW', msg: `Fell back to speech_bubble — Gemini type="${type}" not recognized` });

  return issues;
}

// ── Main test plan ─────────────────────────────────────────────────────────────

async function main() {
  // Kage no Jitsuryokusha (The Eminence in Shadow) — known 37-page chapter 1
  // Mix of pages: ch1 p2 (title page), p5 (intro), p10 (dialogue), p20 (action SFX)
  const MANGA_ID = '77bee52c-d2d6-44ad-a33a-1734c1fe696a';
  const MANGA_LABEL = 'eminence-in-shadow';

  console.log('Fetching chapter list...');
  const feedRes = await fetch(
    `https://api.mangadex.org/manga/${MANGA_ID}/feed?limit=30&translatedLanguage[]=en&order[chapter]=asc&contentRating[]=safe`,
    { headers: { 'User-Agent': MD_UA } }
  );
  const feed = await feedRes.json();
  const ch1 = feed.data?.[0];
  if (!ch1) throw new Error('No chapter found');

  const srvRes = await fetch(`https://api.mangadex.org/at-home/server/${ch1.id}`, { headers: { 'User-Agent': MD_UA } });
  const srv = await srvRes.json();
  const pages = (srv.chapter.data || []).map(f => `${srv.baseUrl}/data/${srv.chapter.hash}/${f}`);

  console.log(`Chapter ${ch1.attributes.chapter}: ${pages.length} pages available`);

  // Test page indices: cover/title (0), first dialogue (2), mid-chapter (5), action page (10)
  // Filter to available pages
  const targetIndices = [0, 2, 5, 10, 14].filter(i => i < pages.length);
  console.log(`Testing pages: ${targetIndices.map(i => i+1).join(', ')}`);

  const allResults = [];
  const failureCounts = {
    OCR: 0, Classification: 0, BubbleDetection: 0,
    Segmentation: 0, Inpainting: 0, Layout: 0, Renderer: 0,
  };
  const allFailures = {
    OCR: [], Classification: [], BubbleDetection: [],
    Segmentation: [], Inpainting: [], Layout: [], Renderer: [],
  };

  for (const idx of targetIndices) {
    const url = pages[idx];
    const prefix = `${MANGA_LABEL}-ch${ch1.attributes.chapter || '1'}-p${idx+1}`;
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`Page ${idx+1} of ${pages.length}`);
    console.log(`URL: ${url.slice(0, 80)}`);

    // OCR
    let ocrResult;
    try {
      const t0 = Date.now();
      ocrResult = await geminiOCR(url);
      const ms = Date.now() - t0;
      console.log(`  OCR: ${ocrResult.regions.length} regions in ${ms}ms (${ocrResult.model})`);
      if (ocrResult.regions.length > 0) {
        const types = [...new Set(ocrResult.regions.map(r => r.type || '?'))];
        console.log(`  types found: [${types.join(', ')}]`);
        console.log(`  summary: "${ocrResult.summary}"`);
      } else {
        console.log(`  summary: "${ocrResult.summary}" ← no text regions`);
        if (!ocrResult.found) {
          allFailures.OCR.push({ page: idx+1, msg: `Gemini reported found=false — page may be wordless or OCR missed text` });
          failureCounts.OCR++;
        }
      }
    } catch (e) {
      console.log(`  OCR FAILED: ${e.message}`);
      allFailures.OCR.push({ page: idx+1, msg: e.message });
      failureCounts.OCR++;
      continue;
    }

    // Run diagnostic
    let diag;
    try {
      const t0 = Date.now();
      diag = await runDiag(url, ocrResult.regions);
      console.log(`  Pipeline: ${Date.now()-t0}ms | timing: ${JSON.stringify(diag.timing)}`);
      console.log(`  Classes:  ${JSON.stringify(diag.summary)}`);
    } catch (e) {
      console.log(`  PIPELINE FAILED: ${e.message}`);
      continue;
    }

    saveDiag(diag, prefix);
    console.log(`  Saved: diagnostic-output/${prefix}/`);

    // Analyze per-region failures
    let pageFailures = 0;
    for (const r of (diag.regions || [])) {
      const issues = analyzeRegion(r);
      for (const iss of issues) {
        console.log(`  ⚠ [${iss.sev}] ${iss.stage} #${r.index}: ${iss.msg}`);
        allFailures[iss.stage]?.push({ page: idx+1, regionIndex: r.index, ...iss });
        failureCounts[iss.stage] = (failureCounts[iss.stage] || 0) + 1;
        pageFailures++;
      }
    }

    // Additional page-level OCR check
    const shouldHaveText = ocrResult.regions.length > 0 && (diag.regions || []).length === 0;
    if (shouldHaveText) {
      console.log(`  ⚠ [HIGH] OCR: regions returned by Gemini but none reached pipeline`);
    }

    allResults.push({
      prefix,
      page: idx + 1,
      url,
      imageSize: diag.imageSize,
      ocrRegions: ocrResult.regions.length,
      ocrFound: ocrResult.found,
      ocrModel: ocrResult.model,
      ocrTypes: [...new Set(ocrResult.regions.map(r => r.type || '?'))],
      geminiSummary: ocrResult.summary,
      classSummary: diag.summary,
      timing: diag.timing,
      pageFailures,
    });

    await sleep(3000); // rate limit headroom
  }

  // ── Summary report ────────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(60));
  console.log('ROOT CAUSE FAILURE REPORT');
  console.log('═'.repeat(60));
  console.log(`Pages analyzed: ${allResults.length}`);
  console.log(`Total regions across all pages: ${allResults.reduce((s, r) => s + r.ocrRegions, 0)}`);

  let grandTotal = 0;
  for (const [stage, list] of Object.entries(allFailures)) {
    if (list.length === 0) continue;
    console.log(`\n${stage}: ${list.length} failures`);
    for (const f of list.slice(0, 5)) {
      console.log(`  p${f.page}${f.regionIndex != null ? ' #'+f.regionIndex : ''} [${f.sev || ''}]: ${f.msg}`);
    }
    grandTotal += list.length;
  }

  if (grandTotal === 0) {
    console.log('\n  No failures detected in this sample!');
  }
  console.log(`\nTotal failures: ${grandTotal}`);

  const report = {
    manga: MANGA_LABEL,
    pagesAnalyzed: allResults.length,
    totalRegions: allResults.reduce((s, r) => s + r.ocrRegions, 0),
    failureCounts,
    failureDetails: allFailures,
    pageResults: allResults,
  };

  writeFileSync(join(OUT, 'focused-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nFull report: ${OUT}/focused-report.json`);

  return report;
}

await main();
