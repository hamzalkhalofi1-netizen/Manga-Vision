/**
 * Targeted test: page 11 (dense speech bubbles) with thinkingBudget:0
 * and raw-response logging to determine whether:
 *   A) Gemini returns empty/unparseable JSON
 *   B) Gemini thinking mode is causing the empty result
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY not set");
const OUT = '/home/runner/workspace/diagnostic-output';
mkdirSync(OUT, { recursive: true });

const CDN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

// Eminence in Shadow ch1 page 11 URL — fetched from MangaDex at-home
const MANGA_ID  = '77bee52c-d2d6-44ad-a33a-1734c1fe696a';
const MD_UA     = 'MangaVerse-Diagnostic/1.0';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function mdGet(path) {
  const r = await fetch(`https://api.mangadex.org${path}`, { headers: { 'User-Agent': MD_UA } });
  return r.json();
}

async function fetchB64(url) {
  const r = await fetch(url, {
    headers: { 'Referer': 'https://mangadex.org/', 'User-Agent': CDN_UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Image ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { base64: buf.toString('base64'), mimeType: (r.headers.get('content-type')||'image/jpeg').split(';')[0].trim(), sizeKB: Math.round(buf.length/1024) };
}

// Two different prompts to find which works better
const PROMPT_SIMPLE = `List every piece of text visible on this manga page. For each:
- text: exact text content
- type: "speech" | "thought" | "sfx" | "narration" | "title" | "credits" | "watermark"
- x, y, w, h: position (0.0 to 1.0 normalized, top-left origin)
- translated: Arabic translation

Return JSON only:
{"regions":[{"original":"...","translated":"...","type":"speech","x":0.1,"y":0.05,"w":0.3,"h":0.1}]}

If no text at all: {"regions":[]}`;

const PROMPT_FULL = `You are a manga OCR engine. For every visible text on this page return JSON:
{"found":true,"regions":[{"original":"...","translated":"...","polygon":[[x,y],[x,y],[x,y],[x,y]],"bubblePolygon":[[x,y],...],"x":0.1,"y":0.05,"w":0.3,"h":0.1,"type":"speech","bgColor":"#fff","textColor":"#000","speaker":null,"emphasis":false}],"summary":"..."}
Types: "speech" | "thought" | "sfx" | "sign" | "narration" | "title" | "credits" | "watermark"
Translate all text to Arabic. Return ONLY valid JSON.`;

async function testModel(url, modelName, prompt, thinkingBudget) {
  const { base64, mimeType, sizeKB } = await fetchB64(url);
  console.log(`\n  model: ${modelName}, thinking: ${thinkingBudget ?? 'default'}, img: ${sizeKB}KB`);

  const generationConfig = { maxOutputTokens: 4096 };
  if (thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget };
  }

  const t0 = Date.now();
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: prompt },
        ]}],
        generationConfig,
      }),
      signal: AbortSignal.timeout(90000),
    }
  );
  const ms = Date.now() - t0;
  const gd = await r.json();

  if (gd.error) {
    console.log(`  ERROR (${ms}ms): ${gd.error.message}`);
    return { ok: false, ms, error: gd.error.message };
  }

  const raw = gd.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  const rawLen = raw.length;
  console.log(`  response: ${ms}ms, raw length: ${rawLen} chars`);
  // Print first 500 chars of raw response (NOT the key, just the model response)
  console.log(`  raw preview: ${raw.slice(0, 500)}`);

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; }
    catch { parsed = null; }
  }

  const regions = parsed?.regions || [];
  console.log(`  parsed regions: ${regions.length}`);
  if (regions.length > 0) {
    console.log(`  types: [${[...new Set(regions.map(r => r.type))].join(', ')}]`);
    console.log(`  first region: "${regions[0].original?.slice(0,50)}"`);
  }

  return { ok: true, ms, rawLen, regions, parsed };
}

async function main() {
  // Get page 11 URL
  const feed = await mdGet(`/manga/${MANGA_ID}/feed?limit=30&translatedLanguage[]=en&order[chapter]=asc&contentRating[]=safe`);
  const ch = feed.data?.[0];
  const srv = await mdGet(`/at-home/server/${ch.id}`);
  const pages = (srv.chapter.data || []).map(f => `${srv.baseUrl}/data/${srv.chapter.hash}/${f}`);

  const p11url = pages[10]; // page 11 (0-indexed: 10)
  const p15url = pages[14]; // page 15 (0-indexed: 14)

  console.log(`Page 11: ${p11url.slice(0, 80)}`);
  console.log(`Page 15: ${p15url.slice(0, 80)}`);

  const results = [];

  // Test 1: gemini-2.5-flash with thinkingBudget=0 (disable thinking)
  console.log('\n═══ Test A: gemini-2.5-flash, thinkingBudget=0, simple prompt ═══');
  results.push(await testModel(p11url, 'gemini-2.5-flash', PROMPT_SIMPLE, 0));
  await sleep(3000);

  // Test 2: gemini-2.5-flash with thinkingBudget=0, full prompt
  console.log('\n═══ Test B: gemini-2.5-flash, thinkingBudget=0, full prompt ═══');
  results.push(await testModel(p11url, 'gemini-2.5-flash', PROMPT_FULL, 0));
  await sleep(3000);

  // Test 3: gemini-2.0-flash, no thinking config
  console.log('\n═══ Test C: gemini-2.0-flash, no thinking, simple prompt ═══');
  results.push(await testModel(p11url, 'gemini-2.0-flash', PROMPT_SIMPLE, undefined));
  await sleep(3000);

  // Test 4: gemini-2.0-flash, full prompt on page 15
  console.log('\n═══ Test D: gemini-2.0-flash, no thinking, full prompt, page 15 ═══');
  results.push(await testModel(p15url, 'gemini-2.0-flash', PROMPT_FULL, undefined));

  // Summary
  console.log('\n\n═══ RESULTS SUMMARY ═══');
  const labels = ['A: 2.5-flash thinking=0 simple', 'B: 2.5-flash thinking=0 full', 'C: 2.0-flash simple', 'D: 2.0-flash full (p15)'];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const status = r.ok ? `${r.regions?.length || 0} regions in ${r.ms}ms` : `ERROR: ${r.error}`;
    console.log(`  ${labels[i]}: ${status}`);
  }

  writeFileSync(join(OUT, 'targeted-results.json'), JSON.stringify({ labels, results: results.map(r => ({
    ok: r.ok, ms: r.ms, rawLen: r.rawLen, regionCount: r.regions?.length || 0,
    types: r.regions ? [...new Set(r.regions.map(x => x.type))] : [],
    error: r.error,
  })) }, null, 2));
}

await main();
