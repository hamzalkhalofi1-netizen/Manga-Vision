/**
 * MangaVerse — Full Pipeline Diagnostic
 * Fetches real manga pages, runs Gemini OCR, feeds into debug-pipeline.
 * Usage: node diagnostic-run.mjs
 * Requires: GEMINI_API_KEY env var, API server on localhost:3000
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY not set");

const OUT = '/home/runner/workspace/diagnostic-output';
mkdirSync(OUT, { recursive: true });

const CDN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MD_UA  = 'MangaVerse-Diagnostic/1.0 (github.com/mangaverse)';

// ── MangaDex ──────────────────────────────────────────────────────────────────

async function mdGet(path) {
  const r = await fetch(`https://api.mangadex.org${path}`, { headers: { 'User-Agent': MD_UA } });
  if (!r.ok) throw new Error(`MangaDex ${r.status}: ${path}`);
  return r.json();
}

async function getChapterPages(mangaId, chapterIdx = 0) {
  const feed = await mdGet(`/manga/${mangaId}/feed?limit=30&translatedLanguage[]=en&order[chapter]=asc&contentRating[]=safe`);
  const ch = feed.data?.[chapterIdx];
  if (!ch) return null;

  const srv = await mdGet(`/at-home/server/${ch.id}`);
  return {
    id: ch.id,
    chapterNum: ch.attributes.chapter || '?',
    pages: (srv.chapter.data || []).map(f => `${srv.baseUrl}/data/${srv.chapter.hash}/${f}`),
  };
}

// ── Gemini OCR ────────────────────────────────────────────────────────────────

const PROMPT = `You are a professional manga OCR and translation engine.

For EVERY piece of text on this page:
1. LOCATE: polygon (4 pts tight around glyphs), bubblePolygon (4-8 pts full bubble outline), x/y/w/h (all normalized 0-1)
2. DETECT: bgColor (hex behind text), textColor (hex of text)
3. CLASSIFY type:
   "speech"    = dialogue in speech bubble
   "thought"   = thought bubble
   "sfx"       = sound effects
   "sign"      = signs, labels, titles in scene
   "narration" = caption/narration boxes
   "title"     = chapter/volume title cards
   "credits"   = scanlation credits (translator/editor names, group names)
   "watermark" = website URL watermarks
4. TRANSLATE to Arabic (natural, emotionally vivid — manga localized)

Return ONLY valid JSON, no markdown:
{"found":true,"regions":[{"original":"...","translated":"...","polygon":[[x,y],[x,y],[x,y],[x,y]],"bubblePolygon":[[x,y],...],"x":0.1,"y":0.05,"w":0.32,"h":0.13,"type":"speech","bgColor":"#ffffff","textColor":"#000000","speaker":null,"emphasis":false}],"summary":"..."}

If no text: {"found":false,"regions":[],"summary":"No text"}`;

async function fetchB64(url, referer = 'https://mangadex.org/') {
  const r = await fetch(url, {
    headers: { 'User-Agent': CDN_UA, 'Referer': referer, 'Accept': 'image/webp,image/apng,image/*,*/*' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Image fetch ${r.status}: ${url.slice(0, 80)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  return { base64: buf.toString('base64'), mimeType: mime, sizeKB: Math.round(buf.length / 1024) };
}

async function geminiOCR(imageUrl) {
  const t0 = Date.now();
  const { base64, mimeType, sizeKB } = await fetchB64(imageUrl);
  console.log(`    image: ${sizeKB}KB ${mimeType}`);

  const body = JSON.stringify({
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: PROMPT },
    ]}],
    generationConfig: { maxOutputTokens: 8192 },
  });

  const gr = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(90000) }
  );
  const gd = await gr.json();
  if (gd.error) throw new Error(`Gemini: ${gd.error.message}`);

  const raw = gd.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : { found: false, regions: [] }; }
    catch { parsed = { found: false, regions: [] }; }
  }

  const regions = (parsed.regions || [])
    .filter(r => typeof r.x === 'number' && typeof r.y === 'number');

  console.log(`    OCR: ${regions.length} regions in ${Date.now() - t0}ms`);
  if (regions.length > 0) {
    const types = [...new Set(regions.map(r => r.type))].join(', ');
    console.log(`    types: [${types}]`);
    console.log(`    summary: ${parsed.summary || '—'}`);
  }

  return { regions, found: parsed.found || regions.length > 0, summary: parsed.summary || '', ocrMs: Date.now() - t0 };
}

// ── Debug pipeline ────────────────────────────────────────────────────────────

async function runDiag(imageUrl, regions) {
  const t0 = Date.now();
  const r = await fetch('http://localhost:3000/api/debug-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl, regions }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`debug-pipeline ${r.status}: ${err.slice(0, 400)}`);
  }
  const d = await r.json();
  console.log(`    diag: ${JSON.stringify(d.timing || {})}`);
  console.log(`    classes: ${JSON.stringify(d.summary || {})}`);
  return { ...d, totalDiagMs: Date.now() - t0 };
}

function saveDiag(d, prefix) {
  const dir = join(OUT, prefix);
  mkdirSync(dir, { recursive: true });
  for (const [k, b64] of Object.entries(d.stages || {})) {
    writeFileSync(join(dir, `${k}.png`), Buffer.from(b64, 'base64'));
  }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(
    { regions: d.regions, summary: d.summary, timing: d.timing, imageSize: d.imageSize },
    null, 2
  ));
  return dir;
}

// ── Failure analysis ──────────────────────────────────────────────────────────

function analyzeFailures(diagResult, ocrResult) {
  const failures = [];
  const { regions } = diagResult;

  if (!ocrResult.found || ocrResult.regions.length === 0) {
    failures.push({ stage: 'OCR', severity: 'CRITICAL', detail: 'No regions returned for page with visible text' });
  }

  for (const r of regions) {
    const type = r.detectedType || '';
    const cls  = r.textClass   || '';

    // Wrong filter — title/credits reaching renderer
    if ((type === 'title' || type === 'credits' || type === 'watermark') && r.shouldRender) {
      failures.push({ stage: 'Classification', severity: 'HIGH',
        detail: `#${r.index} type="${type}" → class="${cls}" → shouldRender=true (should be false)`,
        regionIndex: r.index });
    }

    // Speech bubble incorrectly blocked from rendering
    if ((type === 'speech' || type === 'thought' || type === 'narration') && !r.shouldRender) {
      failures.push({ stage: 'Classification', severity: 'HIGH',
        detail: `#${r.index} type="${type}" → class="${cls}" → shouldRender=false (should be true) reason="${r.reason}"`,
        regionIndex: r.index });
    }

    // Gemini gave wrong type for a speech bubble that the model should know
    if (type === '' && r.shouldRender) {
      failures.push({ stage: 'OCR', severity: 'MEDIUM',
        detail: `#${r.index} missing type field from Gemini`, regionIndex: r.index });
    }

    // No CV-refined bubble — falling back to Gemini/OCR polygon
    if (r.shouldRender && !r.refinedBubblePolygon) {
      failures.push({ stage: 'BubbleDetection', severity: 'MEDIUM',
        detail: `#${r.index} no CV-refined contour — using ${r.bubblePolygon ? 'Gemini' : 'OCR bbox'} fallback`,
        regionIndex: r.index });
    }

    // Bubble polygon area too small for Arabic text
    const rr = r.renderRect;
    if (r.shouldRender && rr) {
      const area = rr.w * rr.h;
      if (area < 0.003) {
        failures.push({ stage: 'Layout', severity: 'MEDIUM',
          detail: `#${r.index} render area ${(area * 100).toFixed(2)}% — likely too small for Arabic text`,
          regionIndex: r.index });
      }
    }

    // shouldRender but no translated text
    if (r.shouldRender && !r.translatedText?.trim()) {
      failures.push({ stage: 'OCR', severity: 'HIGH',
        detail: `#${r.index} shouldRender=true but translatedText is empty`,
        regionIndex: r.index });
    }
  }

  return failures;
}

// ── Test scenarios: dynamically discovered from MangaDex top charts ───────────

async function discoverTestManga() {
  // Fetch top popular safe manga with English chapters available
  const r = await mdGet('/manga?limit=20&order[followedCount]=desc&contentRating[]=safe&hasAvailableChapters=true&availableTranslatedLanguage[]=en');
  const candidates = (r.data || []).map(m => ({
    id: m.id,
    label: (m.attributes.title.en || Object.values(m.attributes.title)[0] || 'unknown')
      .replace(/[^a-z0-9]/gi, '_').slice(0, 20).toLowerCase(),
    // Prefer manga with action/comedy tags for diverse SFX/bubble coverage
    hasAction: m.attributes.tags.some(t => ['Action', 'Adventure', 'Comedy'].includes(t.attributes.name.en || '')),
  }));

  // Pick 4: mix of action and non-action for diverse test coverage
  const action = candidates.filter(m => m.hasAction).slice(0, 2);
  const other  = candidates.filter(m => !m.hasAction).slice(0, 2);
  const picked = [...action, ...other].slice(0, 4);

  return picked.map((m, i) => ({
    ...m,
    pages: i === 0 ? [0, 1, 2] : [0, 1],  // more pages for first manga
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const allResults = [];
  const failureBuckets = {
    OCR: [], Classification: [], BubbleDetection: [],
    Segmentation: [], Inpainting: [], Layout: [], Renderer: [],
  };

  console.log('Discovering manga from MangaDex top charts...');
  const TEST_MANGA = await discoverTestManga();
  console.log('Selected:', TEST_MANGA.map(m => m.label).join(', '));

  for (const manga of TEST_MANGA) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Manga: ${manga.label} (${manga.id})`);

    let ch;
    try {
      ch = await getChapterPages(manga.id, 0);
      if (!ch) { console.log('  No English chapter found'); continue; }
      console.log(`  Chapter ${ch.chapterNum}, ${ch.pages.length} pages`);
    } catch (e) {
      console.log(`  Chapter fetch error: ${e.message}`);
      continue;
    }

    for (const pageIdx of manga.pages) {
      const url = ch.pages[pageIdx];
      if (!url) continue;

      const prefix = `${manga.label}-ch${ch.chapterNum}-p${pageIdx + 1}`;
      console.log(`\n  Page ${pageIdx + 1}:`);
      console.log(`    url: ${url.slice(0, 80)}...`);

      // OCR
      let ocrResult;
      try {
        ocrResult = await geminiOCR(url);
      } catch (e) {
        console.log(`    OCR ERROR: ${e.message}`);
        failureBuckets.OCR.push({ manga: manga.label, page: pageIdx + 1, error: e.message });
        continue;
      }

      // Diagnostic
      let diagResult;
      try {
        diagResult = await runDiag(url, ocrResult.regions);
      } catch (e) {
        console.log(`    DIAG ERROR: ${e.message}`);
        continue;
      }

      // Save
      saveDiag(diagResult, prefix);
      console.log(`    saved → diagnostic-output/${prefix}/`);

      // Analyze
      const failures = analyzeFailures(diagResult, ocrResult);
      for (const f of failures) {
        console.log(`    ⚠ [${f.severity}] ${f.stage}: ${f.detail}`);
        if (failureBuckets[f.stage]) failureBuckets[f.stage].push({ manga: manga.label, page: pageIdx + 1, ...f });
      }

      allResults.push({
        label: prefix,
        manga: manga.label,
        page: pageIdx + 1,
        url,
        ocrRegions: ocrResult.regions.length,
        ocrFound: ocrResult.found,
        ocrTypes: [...new Set(ocrResult.regions.map(r => r.type))],
        geminiSummary: ocrResult.summary,
        classSummary: diagResult.summary || {},
        timing: diagResult.timing || {},
        failures,
        failureCount: failures.length,
      });

      await new Promise(res => setTimeout(res, 2500)); // respect rate limits
    }
  }

  // ── Final report ────────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(60));
  console.log('ROOT CAUSE FAILURE REPORT');
  console.log('═'.repeat(60));

  let totalFailures = 0;
  for (const [stage, list] of Object.entries(failureBuckets)) {
    if (list.length > 0) {
      console.log(`\n  ${stage}: ${list.length} failures`);
      for (const f of list.slice(0, 3)) {
        console.log(`    ${f.severity || ''} ${f.detail || f.error || ''}`);
      }
      totalFailures += list.length;
    }
  }

  console.log(`\n  Total failures across ${allResults.length} pages: ${totalFailures}`);

  const stageCounts = Object.fromEntries(
    Object.entries(failureBuckets).map(([k, v]) => [k, v.length])
  );

  writeFileSync(join(OUT, 'full-report.json'), JSON.stringify({
    pagesAnalyzed: allResults.length,
    totalFailures,
    failuresByStage: stageCounts,
    failureDetails: failureBuckets,
    pageResults: allResults,
  }, null, 2));

  console.log(`\nSaved: ${OUT}/full-report.json`);
  console.log('Stage images: diagnostic-output/<label>/s*.png');

  return { totalFailures, stageCounts, allResults };
}

const result = await main();
console.log('\nDone:', JSON.stringify(result.stageCounts, null, 2));
