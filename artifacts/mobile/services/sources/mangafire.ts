import { Platform } from "react-native";
import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";
import { webViewBridge } from "../webViewBridge";

const SITE_URL = "https://mangafire.to";

// ── Two distinct fetch modes ──────────────────────────────────────────────
// 1. AJAX (XHR) mode: sends X-Requested-With header, expects JSON wrapper
//    {status, result}. Used for chapter/page data only.
// 2. HTML mode: plain browser-like fetch, no XHR header. Used for
//    listing/browsing/search pages because the AJAX list endpoints
//    return 404/403 for those paths.

const BASE_OPTS = {
  sourceId: "mangafire",
  siteUrl: SITE_URL,
  timeoutMs: 18000,
};

const XHR_OPTS = {
  ...BASE_OPTS,
  headers: {
    Accept: "application/json, text/html, */*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: SITE_URL + "/",
  },
};

const HTML_OPTS = {
  ...BASE_OPTS,
  headers: {
    Accept: "text/html,application/xhtml+xml,*/*",
    Referer: SITE_URL + "/",
  },
};

async function mfHtmlFetch(path: string, query = ""): Promise<string> {
  const res = await proxiedFetch("mangafire", path, query, HTML_OPTS);
  return res.text();
}

async function mfXhrFetch(
  path: string,
  query = "",
  opts?: { refererUrl?: string },
): Promise<Record<string, unknown>> {
  const url = `${SITE_URL}${path}${query}`;
  let jsonText: string;

  if (Platform.OS !== "web") {
    // Native: run the XHR inside the persistent mangafire WebView.
    // That WebView already has cf_clearance in its cookie store.
    // Note: browser fetch() Referer is set automatically from the WebView's
    // current page URL — we cannot override it in JS fetch headers.
    const resp = await webViewBridge.fetch("mangafire", url, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      timeoutMs: 18000,
    });
    if (!resp.ok && (resp.status === 403 || resp.status === 503)) {
      throw new SourceError(
        "MangaFire requires browser verification.",
        "cloudflare", resp.status, "mangafire",
      );
    }
    jsonText = resp.body;
  } else {
    // Web: route through server-side proxy with optional Referer override.
    // MangaFire /ajax/read/{token}/chapter/en requires Referer = reader page URL.
    const extraHeaders: Record<string, string> = {};
    if (opts?.refererUrl) {
      extraHeaders["x-proxy-referer"] = opts.refererUrl;
    }
    const res = await proxiedFetch("mangafire", path, query, XHR_OPTS, {
      headers: { ...XHR_OPTS.headers, ...extraHeaders },
    });
    jsonText = await res.text();
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new SourceError("MangaFire: invalid JSON from AJAX endpoint", "upstream", undefined, "mangafire");
  }

  const status = typeof json.status === "number" ? json.status : 200;
  console.log(`[mangafire] XHR ${path}${query} → status=${status}`);
  if (status === 404) {
    throw new SourceError(`MangaFire: ${path} not found (404)`, "not_found", 404, "mangafire");
  }
  if (status === 403) {
    throw new SourceError(`MangaFire: ${path} blocked (403)`, "cloudflare", 403, "mangafire");
  }
  return json;
}

// ── Cloudflare detection ───────────────────────────────────────────────────

function isCloudflarePage(html: string): boolean {
  return /just a moment|checking your browser|cf-browser-verification|challenge-form|attention required/i.test(html);
}

// ── Slug → numeric ID extraction ─────────────────────────────────────────
// MangaFire slugs: "one-piece.9ox5" — AJAX endpoints need just "9ox5"
// The detail page URL uses the full slug; AJAX uses only the suffix.

function extractMfId(slug: string): string {
  const dotIdx = slug.lastIndexOf(".");
  return dotIdx >= 0 ? slug.slice(dotIdx + 1) : slug;
}

// ── HTML parsers ──────────────────────────────────────────────────────────

/**
 * Parse a MangaFire HTML listing page (e.g. /filter?sortby=latest).
 * Card structure:
 *   <div class="unit item-{id}">
 *     <div class="inner">
 *       <a href="/manga/{slug}" class="poster" data-tip="...">
 *         <div><img src="{cover}" alt="{title}"></div>
 *       </a>
 */
function parseMangaListHtml(html: string): Manga[] {
  const results: Manga[] = [];
  const seen = new Set<string>();

  // Primary: poster+img pattern (cover + title in alt)
  const re =
    /<a[^>]+href="(\/manga\/([\w.-]+))"[^>]*class="[^"]*poster[^"]*"[\s\S]{0,300}?<img[^>]+src="([^"]+)"[^>]+alt="([^"]{2,120})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, , slug, cover, title] = m;
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      results.push({ id: slug, title: title.trim(), coverUrl: cover, sourceId: "mangafire" });
    }
  }

  // Fallback: unit card with class="unit" anchor
  if (results.length === 0) {
    const re2 = /<a[^>]+class="[^"]*unit[^"]*"[^>]+href="\/manga\/([\w.-]+)"[^>]*>([^<]{2,120})<\/a>/g;
    while ((m = re2.exec(html)) !== null) {
      const [, slug, title] = m;
      if (!seen.has(slug)) {
        seen.add(slug);
        results.push({ id: slug, title: title.trim(), coverUrl: "", sourceId: "mangafire" });
      }
    }
  }

  console.log(`[mangafire] parseMangaListHtml → ${results.length} items. CF: ${isCloudflarePage(html)}`);
  return results;
}

/**
 * Parse the /home AJAX response which returns HTML inside a JSON wrapper.
 * Returns {status:200, result: "<HTML>"}
 */
async function fetchHomeHtml(): Promise<string> {
  const json = await mfXhrFetch("/home");
  const html = typeof json.result === "string" ? json.result : "";
  console.log(`[mangafire] /home HTML length: ${html.length}`);
  return html;
}

// ── Chapter parsing ──────────────────────────────────────────────────────

/**
 * Parse chapters from MangaFire chapter list HTML.
 *
 * Confirmed AJAX response structure (2025):
 *   <ul class="scroll-sm">
 *     <li class="item" data-number="104">
 *       <a href="/read/dragon-ball-superr.4qo/en/chapter-104" title="Vol 24 - Chap 104">
 *         <span>Chapter 104: The Birth of Saiyaman X</span>
 *         <span>May 02, 2025</span>
 *       </a>
 *     </li>
 *   </ul>
 *
 * Chapter ID: full reader path (e.g. "/read/slug/en/chapter-104")
 * Chapter number: data-number attribute on <li>
 */
function parseChaptersFromHtml(html: string, context: string): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // Snippet for debugging
  if (html.length > 0) {
    console.log(`[mangafire] parseChaptersFromHtml(${context}) size=${html.length} snippet="${html.slice(0, 200).replace(/\s+/g, " ")}"`);
  }

  // ── Strategy 1: <li data-number="{N}"><a href="/read/..."> ───────────────
  // This is the confirmed 2025 structure from the AJAX chapter endpoint.
  // The href path is used as the chapter ID so getChapterPages can fetch the reader.
  const liRe = /<li[^>]*\bdata-number="([\d.]+)"[^>]*>[\s\S]{0,400}?<a\s[^>]*href="(\/read\/[^"]+)"[^>]*>[\s\S]{0,200}?<span>([^<]{0,200})<\/span>[\s\S]{0,100}?<span>([^<]{0,50})<\/span>/g;
  while ((m = liRe.exec(html)) !== null) {
    const [, num, href, titleSpan, dateSpan] = m;
    if (seen.has(href)) continue;
    seen.add(href);
    // Strip "Chapter N: " prefix from title span to get clean title
    const title = titleSpan.replace(/^[Cc]hapter\s*[\d.]+[:\s-]*/u, "").trim() || undefined;
    chapters.push({ id: href, number: num, title, publishedAt: dateSpan.trim() });
  }
  if (chapters.length > 0) {
    console.log(`[mangafire] parseChaptersFromHtml(${context}) s1 data-number+/read/ → ${chapters.length}`);
    return chapters;
  }

  // ── Strategy 2: <li data-number> without href capture (just number) ───────
  const numOnlyRe = /<li[^>]*\bdata-number="([\d.]+)"[^>]*>[\s\S]{0,300}?href="(\/read\/[^"]+)"/g;
  while ((m = numOnlyRe.exec(html)) !== null) {
    const [, num, href] = m;
    if (seen.has(href)) continue;
    seen.add(href);
    chapters.push({ id: href, number: num, publishedAt: "" });
  }
  if (chapters.length > 0) {
    console.log(`[mangafire] parseChaptersFromHtml(${context}) s2 data-number href → ${chapters.length}`);
    return chapters;
  }

  // ── Strategy 3: any /read/{slug}/{lang}/chapter-{N} href ─────────────────
  const readRe = /href="(\/read\/[\w.-]+\/\w+\/chapter-([\d.]+)[^"]*)"/g;
  while ((m = readRe.exec(html)) !== null) {
    const [, href, num] = m;
    if (seen.has(href)) continue;
    // Look for date nearby
    const ctx = html.slice(m.index, m.index + 200);
    const dateM = ctx.match(/(\w{3}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/);
    seen.add(href);
    chapters.push({ id: href, number: num, publishedAt: dateM?.[1] ?? "" });
  }
  if (chapters.length > 0) {
    console.log(`[mangafire] parseChaptersFromHtml(${context}) s3 /read/chapter-N → ${chapters.length}`);
    return chapters;
  }

  // ── Strategy 4: legacy data-id pattern ───────────────────────────────────
  const dataIdRe = /data-id="([^"]+)"[^>]*>[\s\S]{0,400}?[Cc]hapter\s*([\d.]+)/g;
  while ((m = dataIdRe.exec(html)) !== null) {
    const [, chId, num] = m;
    if (seen.has(chId)) continue;
    seen.add(chId);
    chapters.push({ id: chId, number: num, publishedAt: "" });
  }
  if (chapters.length > 0) {
    console.log(`[mangafire] parseChaptersFromHtml(${context}) s4 legacy data-id → ${chapters.length}`);
    return chapters;
  }

  // ── Strategy 5: /manga/{slug}/chapter-{N} ────────────────────────────────
  const mangaRe = /href="(\/manga\/[\w.-]+\/chapter-([\d.]+)[^"#?]*)"/g;
  while ((m = mangaRe.exec(html)) !== null) {
    const [, path, num] = m;
    if (seen.has(path)) continue;
    seen.add(path);
    chapters.push({ id: path, number: num, publishedAt: "" });
  }
  console.log(`[mangafire] parseChaptersFromHtml(${context}) s5 /manga/chapter-N → ${chapters.length}`);
  return chapters;
}

/**
 * Parse chapters from the AJAX JSON wrapper response.
 *
 * Known MangaFire response shapes:
 *   { status:200, result: "<HTML chapter list>" }
 *   { status:200, result: { html: "<HTML>", total: N } }
 *   { status:200, result: { en: [[id, num, title, date], ...] } }
 *   { status:200, html: "<HTML>" }   ← html at root
 */
function parseChapters(raw: unknown, slugContext: string): Chapter[] {
  if (!raw || typeof raw !== "object") return [];
  const json = raw as Record<string, unknown>;
  const result = json.result;

  // Comprehensive diagnostics on every call
  const resultType = Array.isArray(result) ? "array" : typeof result;
  const resultPreview = typeof result === "string"
    ? result.slice(0, 120).replace(/\s+/g, " ")
    : typeof result === "object" && result !== null
      ? `keys=[${Object.keys(result as object).slice(0, 6).join(",")}]`
      : String(result);
  console.log(`[mangafire] parseChapters(${slugContext}): resultType=${resultType} preview="${resultPreview}"`);

  // Helper: try to parse an HTML string for chapters
  const tryHtml = (html: string, tag: string): Chapter[] | null => {
    const trimmed = html.trim();
    if (trimmed.length < 10) return null;
    const chapters = parseChaptersFromHtml(trimmed, `${tag}:${slugContext}`);
    if (chapters.length > 0) console.log(`[mangafire] parseChapters [${tag}] html → ${chapters.length} chapters`);
    return chapters.length > 0 ? chapters : null;
  };

  // ── Case 1: result is a raw HTML string ───────────────────────────────────
  if (typeof result === "string") {
    return tryHtml(result, "result-str") ?? [];
  }

  // ── Case 2: result is an object ───────────────────────────────────────────
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;

    // 2a: result.html (very common — MangaFire wraps HTML in a nested object)
    if (typeof r.html === "string") {
      const res = tryHtml(r.html, "result.html");
      if (res) return res;
    }

    // 2b: result.content or result.data as HTML
    for (const key of ["content", "data", "body"]) {
      if (typeof r[key] === "string") {
        const res = tryHtml(r[key] as string, `result.${key}`);
        if (res) return res;
      }
    }

    // 2c: language-keyed tuple/object arrays: result.en, result.all, result.chapters
    for (const key of ["en", "all", "chapters"]) {
      const arr = r[key];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const parsed = arr.map((c): Chapter | null => {
        if (Array.isArray(c)) {
          const id = String(c[0] ?? "");
          if (!id) return null;
          return {
            id,
            number: String(c[1] ?? "?"),
            title: c[2] && String(c[2]) !== "null" ? String(c[2]) : undefined,
            publishedAt: c[3] ? String(c[3]) : "",
          };
        }
        if (c && typeof c === "object") {
          const o = c as Record<string, unknown>;
          const id = String(o.id ?? o.chapter_id ?? "");
          if (!id) return null;
          return {
            id,
            number: String(o.number ?? o.chapter ?? o.chap ?? "?"),
            title: o.title ? String(o.title) : undefined,
            publishedAt: String(o.date ?? o.created_at ?? o.updated_at ?? ""),
          };
        }
        return null;
      }).filter((c): c is Chapter => !!c);
      if (parsed.length > 0) {
        console.log(`[mangafire] parseChapters result.${key} → ${parsed.length} chapters`);
        return parsed;
      }
    }
  }

  // ── Case 3: html at root level (not under result) ─────────────────────────
  if (typeof json.html === "string") {
    return tryHtml(json.html, "root.html") ?? [];
  }

  // ── Case 4: flat chapters array at root (legacy) ──────────────────────────
  if (Array.isArray(json.chapters)) {
    const parsed = (json.chapters as Array<Record<string, unknown>>).map((c) => ({
      id: String(c.id ?? c.chapter_id ?? ""),
      number: String(c.number ?? c.chapter ?? "?"),
      title: c.title ? String(c.title) : undefined,
      publishedAt: String(c.date ?? ""),
    })).filter((c) => c.id);
    if (parsed.length > 0) {
      console.log(`[mangafire] parseChapters root.chapters → ${parsed.length} chapters`);
      return parsed;
    }
  }

  // ── Fallback diagnostic ───────────────────────────────────────────────────
  console.warn(`[mangafire] parseChapters(${slugContext}): exhausted all strategies. Top-level keys:`, Object.keys(json).join(", "));
  return [];
}

// ── Chapter page parsing ───────────────────────────────────────────────────

function parseChapterImages(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const json = raw as Record<string, unknown>;
  const result = json.result;
  const MF_CDN = "https://cdn.mangafire.to";

  // Collect candidate image items from all known response shapes.
  // MangaFire has changed its AJAX format several times:
  //   v1: { result: { images: [[url, w, h], ...] } }
  //   v2: { result: { sources: [{url, width, height}, ...] } }
  //   v3: { result: [[url, w, h], ...] }   ← result is a direct array
  //   v4: { result: { pages: [...] } }
  //   v5: { images: [...] }                ← images at root
  let candidates: unknown[] = [];

  if (Array.isArray(result)) {
    // v3: result is a direct array of tuples
    candidates = result;
    console.log(`[mangafire] parseChapterImages: result is direct array (${candidates.length} items)`);
  } else if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    // Try all known keys in preference order
    for (const key of ["images", "sources", "pages", "data", "imgs"]) {
      if (Array.isArray(r[key]) && (r[key] as unknown[]).length > 0) {
        candidates = r[key] as unknown[];
        console.log(`[mangafire] parseChapterImages: result.${key} (${candidates.length} items)`);
        break;
      }
    }
    // If still empty, try to find any array value in result
    if (candidates.length === 0) {
      for (const val of Object.values(r)) {
        if (Array.isArray(val) && val.length > 0) {
          candidates = val;
          console.log(`[mangafire] parseChapterImages: result (fallback array key, ${candidates.length} items)`);
          break;
        }
      }
    }
  }

  // Root-level fallback
  if (candidates.length === 0) {
    for (const key of ["images", "sources", "pages", "imgs"]) {
      if (Array.isArray(json[key]) && (json[key] as unknown[]).length > 0) {
        candidates = json[key] as unknown[];
        console.log(`[mangafire] parseChapterImages: root.${key} (${candidates.length} items)`);
        break;
      }
    }
  }

  if (candidates.length === 0) {
    console.warn(`[mangafire] parseChapterImages: no image array found. Top-level keys:`, Object.keys(json).join(", "),
      result && typeof result === "object" ? `result keys: ${Object.keys(result as object).join(", ")}` : `result type: ${typeof result}`);
    return [];
  }

  const seen = new Set<string>();

  const toUrl = (img: unknown): string => {
    if (Array.isArray(img)) {
      // Tuple: [url, width, height] or [url]
      const url = img[0];
      if (typeof url === "string" && url) {
        return url.startsWith("http") ? url : `${MF_CDN}/${url.replace(/^\/+/, "")}`;
      }
      return "";
    }
    if (typeof img === "string" && img) {
      return img.startsWith("http") ? img : `${MF_CDN}/${img.replace(/^\/+/, "")}`;
    }
    if (img && typeof img === "object") {
      const o = img as Record<string, unknown>;
      // Handles {url, src, imageUrl, image, link, path}
      const raw = String(o.url ?? o.src ?? o.imageUrl ?? o.image ?? o.link ?? o.path ?? "");
      return raw.startsWith("http") ? raw : raw ? `${MF_CDN}/${raw.replace(/^\/+/, "")}` : "";
    }
    return "";
  };

  const urls = candidates
    .map(toUrl)
    .filter((u): u is string => {
      if (!u || !u.startsWith("http")) return false;
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });

  console.log(`[mangafire] parseChapterImages: ${candidates.length} candidates → ${urls.length} unique URLs`);
  return urls;
}

function parseChapterImagesFromHtml(html: string): string[] {
  const urls = new Set<string>();
  let m: RegExpExecArray | null;

  // Pattern 1: any img src/data-src/data-lazy-src/data-original/data-lazyload targeting CDN
  const flatImgRe = /(?:data-(?:lazy-)?src|data-original|data-lazyload|data-url|src)="(https?:\/\/[^"]*cdn\.mangafire\.to[^"]*\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi;
  while ((m = flatImgRe.exec(html)) !== null) {
    const u = m[1];
    if (!u.includes("logo") && !u.includes("icon") && !u.includes("avatar")) urls.add(u);
  }

  // Pattern 2: broad CDN URL — any path under cdn.mangafire.to ending in image ext.
  // Deliberately broad (no path prefix restriction) to survive CDN restructuring.
  const cdnRe = /(https?:\/\/cdn\.mangafire\.to\/[^"'\s<>]{4,300}\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s<>]*)?)/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    const u = m[1];
    if (!u.includes("logo") && !u.includes("icon") && !u.includes("avatar")) urls.add(u);
  }

  // Pattern 3: CSS background-image: url("https://cdn.mangafire.to/...")
  // MangaFire reader sometimes renders pages as CSS backgrounds, not <img> elements.
  const bgImgRe = /background(?:-image)?\s*:\s*url\(["']?(https?:\/\/cdn\.mangafire\.to\/[^"'\s)]{4,300}\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s)]*)?)/gi;
  while ((m = bgImgRe.exec(html)) !== null) urls.add(m[1]);

  // Pattern 4: JSON arrays in scripts (images/pages/sources as property)
  const scriptRe = /"(?:pages|images|sources|imgs|imageUrls?|urls?)":\s*\[([^\]]{10,})\]/g;
  while ((m = scriptRe.exec(html)) !== null) {
    const inner = m[1];
    const urlRe = /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(inner)) !== null) urls.add(um[1]);
  }

  // Pattern 5: tuple arrays like [["https://...", 800, 1200], ...]
  const tupleRe = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)",\s*\d/gi;
  while ((m = tupleRe.exec(html)) !== null) urls.add(m[1]);

  // Pattern 6: window.__NUXT__ / window.__data__ / window.__INITIAL_STATE__ blobs
  const windowRe = /window\.__[A-Z_]+__\s*=\s*(\{[\s\S]{1,50000}?\})\s*;/g;
  while ((m = windowRe.exec(html)) !== null) {
    const blob = m[1];
    const urlRe = /"(https?:\/\/cdn\.mangafire\.to\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(blob)) !== null) urls.add(um[1]);
  }

  console.log(`[mangafire] parseChapterImagesFromHtml → ${urls.size} images`);
  return [...urls];
}

// ── Web CDN URL rewriter ───────────────────────────────────────────────────

const MF_CDN_PREFIX = "https://cdn.mangafire.to/";

/**
 * On web, direct CDN requests fail because the browser sends the wrong Referer
 * (Replit domain instead of mangafire.to) and expo-image ignores the `headers`
 * prop in web mode.  Route all cdn.mangafire.to URLs through the server proxy
 * which sends Referer: https://mangafire.to/ to the CDN.
 *
 * On native, expo-image sends custom headers (incl. Referer) so direct URLs work.
 */
function rewriteForWeb(urls: string[]): string[] {
  if (Platform.OS !== "web") return urls;
  return urls.map((url) => {
    if (url.startsWith(MF_CDN_PREFIX)) {
      // /api/source-proxy/mangafire-cdn/{path}
      const path = url.slice(MF_CDN_PREFIX.length);
      return `/api/source-proxy/mangafire-cdn/${path}`;
    }
    return url;
  });
}

// ── Chapter session token extraction ─────────────────────────────────────

/**
 * Extract the chapter session token from HTML.
 *
 * The token appears in several places depending on how the page was fetched:
 *   1. data-a="af266caa520a"                    — rendered DOM attribute (native)
 *   2. data-token="af266caa520a"                — alternative attribute name
 *   3. "token":"af266caa520a"                   — JSON config in <script>
 *   4. window.__CHAPTER_DATA__ = {token:"..."}  — global JS variable
 *   5. var token = "af266caa520a"               — variable assignment
 *
 * Returns null when no token is found (web static HTML without JS execution).
 */
function extractChapterToken(html: string): string | null {
  // Pattern 1: data-a attribute (most common in rendered DOM)
  const m1 = html.match(/\bdata-a="([a-z0-9]{6,20})"/);
  if (m1) return m1[1];

  // Pattern 2: alternative data-* attribute names
  const m2 = html.match(/\bdata-(?:token|key|chapter)="([a-z0-9]{6,20})"/);
  if (m2) return m2[1];

  // Pattern 3: JSON key/value in script block
  const m3 = html.match(/"(?:token|chapterToken|chapter_token|a)"\s*:\s*"([a-z0-9]{6,20})"/);
  if (m3) return m3[1];

  // Pattern 4: JS variable assignment (may appear in SSR inline scripts)
  const m4 = html.match(/\bvar\s+(?:token|chapterToken)\s*=\s*["']([a-z0-9]{6,20})["']/);
  if (m4) return m4[1];

  // Pattern 5: NUXT/Next.js SSR JSON blob
  const m5 = html.match(/"token"\s*:\s*"([a-z0-9]{6,20})"/);
  if (m5) return m5[1];

  return null;
}

// ── Source implementation ─────────────────────────────────────────────────

export const mangafireSource: MangaSource = {
  id: "mangafire",
  name: "MangaFire",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: true,

  async getTrending(page = 0): Promise<Manga[]> {
    if (page === 0) {
      try {
        const homeHtml = await fetchHomeHtml();
        if (isCloudflarePage(homeHtml)) {
          throw new SourceError("MangaFire content blocked by Cloudflare verification.", "cloudflare", 403, "mangafire");
        }
        const results = parseMangaListHtml(homeHtml);
        if (results.length > 0) return results;
      } catch (err) {
        if (err instanceof SourceError && err.type === "cloudflare") throw err;
        console.warn("[mangafire] /home fetch failed, falling back to /filter:", err);
      }
    }

    try {
      const qs = `?sortby=trending&page=${page + 1}`;
      const html = await mfHtmlFetch("/filter", qs);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire content blocked by Cloudflare verification.", "cloudflare", 403, "mangafire");
      }
      const results = parseMangaListHtml(html);
      if (results.length === 0) {
        console.warn("[mangafire] PARSER DIAGNOSTIC: getTrending returned 0. HTML size:", html.length);
      }
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    try {
      const qs = `?sortby=latest&page=${page + 1}`;
      const html = await mfHtmlFetch("/filter", qs);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire content blocked by Cloudflare verification.", "cloudflare", 403, "mangafire");
      }
      const results = parseMangaListHtml(html);
      if (results.length === 0) {
        console.warn("[mangafire] PARSER DIAGNOSTIC: getLatestUpdates returned 0. CF:", isCloudflarePage(html), "HTML size:", html.length);
      }
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async search(query: string, page = 0): Promise<Manga[]> {
    try {
      const qs = `?keyword=${encodeURIComponent(query)}&page=${page + 1}`;
      const html = await mfHtmlFetch("/filter", qs);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire search blocked by Cloudflare verification.", "cloudflare", 403, "mangafire");
      }
      const results = parseMangaListHtml(html);
      if (results.length > 0) return results;

      console.warn(`[mangafire] search("${query}") → 0 results. MangaFire blocks keyword search without a browser session.`);
      throw new SourceError(
        `MangaFire search requires browser verification. Try browsing Trending or Latest instead.`,
        "auth",
        403,
        "mangafire"
      );
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(
        "MangaFire search unavailable — keyword search is blocked. Switch to Trending/Latest.",
        "auth",
        403,
        "mangafire"
      );
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const html = await mfHtmlFetch(`/manga/${id}`);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire detail page blocked by Cloudflare.", "cloudflare", 403, "mangafire");
      }
      const titleM =
        html.match(/<h1[^>]*class="[^"]*name[^"]*"[^>]*>([^<]{2,120})<\/h1>/i) ??
        html.match(/<h1[^>]*>([^<]{2,120})<\/h1>/);
      const imgM =
        html.match(/class="[^"]*poster[^"]*"[^>]*>[\s\S]{0,100}?<img[^>]+src="([^"]+)"/) ??
        html.match(/property="og:image"\s+content="([^"]+)"/);
      const descM = html.match(/<div[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]{2,500}?)<\/div>/i);

      return {
        id,
        title: titleM?.[1]?.trim() ?? id.replace(/[.-]/g, " "),
        coverUrl: imgM?.[1] ?? "",
        sourceId: "mangafire",
        description: descM?.[1]?.replace(/<[^>]*>/g, "").trim(),
      };
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return { id, title: id.replace(/[.-]/g, " "), coverUrl: "", sourceId: "mangafire" };
    }
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    // CRITICAL: MangaFire AJAX chapter endpoint uses only the ID suffix,
    // not the full slug. "berserkk.m2vv" → AJAX uses "m2vv"
    const mfId = extractMfId(mangaId);
    console.log(`[mangafire] getChapters: slug=${mangaId} mfId=${mfId}`);

    try {
      const json = await mfXhrFetch(`/ajax/manga/${mfId}/chapter/en`);
      const chapters = parseChapters(json, mangaId);
      if (chapters.length > 0) {
        console.log(`[mangafire] getChapters(${mangaId}) AJAX → ${chapters.length} chapters`);
        return chapters;
      }
      console.warn(`[mangafire] AJAX returned 0 chapters for mfId=${mfId}, falling back to HTML`);
    } catch (err) {
      if (err instanceof SourceError && (err.type === "cloudflare" || err.type === "auth")) throw err;
      console.warn(`[mangafire] AJAX chapter fetch failed for mfId=${mfId}:`, err);
    }

    // HTML fallback: parse chapter list from manga detail page
    try {
      const html = await mfHtmlFetch(`/manga/${mangaId}`);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire chapter list blocked by Cloudflare.", "cloudflare", 403, "mangafire");
      }
      const chapters = parseChaptersFromHtml(html, `detail:${mangaId}`);
      if (chapters.length === 0) {
        console.warn(`[mangafire] PARSER DIAGNOSTIC: getChapters(${mangaId}) HTML fallback → 0. HTML size: ${html.length}`);
      }
      return chapters;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    // chapterId is a reader path like "/read/dragon-ball-superr.4qo/en/chapter-104"
    //
    // Strategy:
    //   Native:  Navigate the persistent WebView to the reader page (fetchRendered,
    //            12s) so MangaFire's React JS fully executes.  Extract images from
    //            the rendered DOM.  If 0 found, fall back to AJAX — the WebView
    //            STAYS on the reader page after fetchRendered (fixed in bridge), so
    //            the AJAX call inherits Referer = reader page URL automatically.
    //   Web:     Fetch static reader HTML via proxy, extract token, then call the
    //            AJAX image endpoint with x-proxy-referer = reader page URL so the
    //            server proxy forwards the correct Referer.  Rewrite CDN image URLs
    //            to go through the server proxy (browser can't send the correct
    //            Referer for cdn.mangafire.to directly).
    try {
      const readerPath = chapterId.startsWith("/") ? chapterId : `/${chapterId}`;
      const fullReaderUrl = `${SITE_URL}${readerPath}`;
      console.log(`[mangafire] getChapterPages: fetching reader page ${readerPath}`);

      let html: string;

      if (Platform.OS !== "web") {
        // Native: navigate the WebView to the reader page so JS can run.
        // 12 s gives MangaFire's React reader time to fetch & render images.
        // After this call, the WebView STAYS on the reader page (bridge fix) so
        // any subsequent webViewBridge.fetch() call inherits Referer = readerUrl.
        const resp = await webViewBridge.fetchRendered("mangafire", fullReaderUrl, 12000);
        if (!resp.ok && (resp.status === 403 || resp.status === 503)) {
          throw new SourceError(
            "MangaFire chapter reader blocked by Cloudflare. Please verify in source settings.",
            "cloudflare", resp.status, "mangafire"
          );
        }
        html = resp.body;
        console.log(`[mangafire] getChapterPages(native): rendered html=${html.length}b`);

        // Try to extract images from the fully-rendered DOM first.
        const renderedImages = parseChapterImagesFromHtml(html);
        if (renderedImages.length > 0) {
          console.log(`[mangafire] getChapterPages(${chapterId}) rendered DOM → ${renderedImages.length} images`);
          return renderedImages; // native: CDN URLs load directly with custom headers
        }
        // WebView stays on reader page after fetchRendered — AJAX call below will
        // have Referer = fullReaderUrl automatically (browser sets it).
        console.log(`[mangafire] getChapterPages(native): DOM had 0 images — trying AJAX (WebView still on reader page)`);
      } else {
        // Web: plain proxy fetch (static HTML, no JS execution).
        html = await mfHtmlFetch(readerPath);
        if (isCloudflarePage(html)) {
          throw new SourceError(
            "MangaFire chapter reader blocked by Cloudflare. Please verify in source settings.",
            "cloudflare", 403, "mangafire"
          );
        }
      }

      // Extract the chapter session token using multi-pattern search.
      // On native the rendered DOM reliably has data-a; on web (static HTML)
      // we fall through additional patterns looking in script blocks.
      const token = extractChapterToken(html);
      console.log(`[mangafire] getChapterPages: token=${token ?? "not found"} html=${html.length}b`);

      if (token) {
        try {
          // On native: WebView is still on the reader page → Referer is set
          //            automatically by the browser — no override needed.
          // On web:    x-proxy-referer tells the server proxy to forward the
          //            reader page URL as Referer to MangaFire's AJAX endpoint.
          const json = await mfXhrFetch(
            `/ajax/read/${token}/chapter/en`,
            "",
            { refererUrl: fullReaderUrl },
          );
          const images = parseChapterImages(json);
          if (images.length > 0) {
            console.log(`[mangafire] getChapterPages(${chapterId}) AJAX → ${images.length} images`);
            return rewriteForWeb(images);
          }
          console.warn(`[mangafire] AJAX returned 0 images for ${chapterId}`);
        } catch (err) {
          if (err instanceof SourceError && err.type === "cloudflare") throw err;
          if (err instanceof SourceError && err.type === "auth") {
            console.warn(`[mangafire] AJAX blocked (needs browser session). Requires verification.`);
            throw new SourceError(
              "MangaFire requires browser verification to load chapter images. Tap 'Verify' in source settings.",
              "auth", 403, "mangafire"
            );
          }
          console.warn(`[mangafire] AJAX failed for ${chapterId}:`, err);
        }
      }

      // HTML fallback: works when images appear in static or rendered HTML.
      const fallbackImages = parseChapterImagesFromHtml(html);
      if (fallbackImages.length > 0) {
        console.log(`[mangafire] getChapterPages(${chapterId}) HTML fallback → ${fallbackImages.length} images`);
        return rewriteForWeb(fallbackImages);
      }

      console.warn(`[mangafire] PARSER DIAGNOSTIC: getChapterPages(${chapterId}) exhausted all strategies. html=${html.length}b token=${token ?? "none"}`);
      if (!token) {
        throw new SourceError(
          "MangaFire chapter images require browser verification. Please verify this source first.",
          "auth", 403, "mangafire"
        );
      }
      return [];
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },
};
