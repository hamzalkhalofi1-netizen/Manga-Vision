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
  const result = json.result as Record<string, unknown> | undefined;

  // Images can be at result.images or root level
  const images = result?.images ?? json.images ?? result?.pages ?? [];
  if (!Array.isArray(images)) return [];

  const MF_CDN = "https://cdn.mangafire.to";

  return images
    .map((img: unknown): string => {
      // Tuple format: [url, width, height] or [url]
      if (Array.isArray(img)) {
        const url = img[0];
        if (typeof url === "string") {
          return url.startsWith("http") ? url : `${MF_CDN}/${url}`;
        }
        return "";
      }
      if (typeof img === "string") {
        return img.startsWith("http") ? img : `${MF_CDN}/${img}`;
      }
      if (img && typeof img === "object") {
        const o = img as Record<string, unknown>;
        const url = String(o.url ?? o.src ?? o.imageUrl ?? "");
        return url.startsWith("http") ? url : url ? `${MF_CDN}/${url}` : "";
      }
      return "";
    })
    .filter((u) => u.startsWith("http"));
}

function parseChapterImagesFromHtml(html: string): string[] {
  // MangaFire reader loads images via JS, but embeds them in a data attribute
  // or inline script. Try multiple patterns.
  const urls = new Set<string>();

  // Pattern 1: img elements with data-src or src
  const re1 = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html)) !== null) {
    if (!m[1].includes("logo") && !m[1].includes("icon")) urls.add(m[1]);
  }

  // Pattern 2: JSON-embedded image arrays in scripts (tuples or strings)
  const scriptRe = /"(?:pages|images|imageUrls?)":\s*\[([^\]]{20,})\]/g;
  while ((m = scriptRe.exec(html)) !== null) {
    const inner = m[1];
    const imgRe2 = /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe2.exec(inner)) !== null) urls.add(im[1]);
  }

  // Pattern 3: bare CDN URL in scripts
  const cdnRe = /(https?:\/\/cdn\.mangafire\.to\/[^"'\s]{4,200}\.(?:jpg|jpeg|png|webp))/gi;
  while ((m = cdnRe.exec(html)) !== null) urls.add(m[1]);

  console.log(`[mangafire] parseChapterImagesFromHtml → ${urls.size} images`);
  return [...urls];
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
    //            7s wait) so MangaFire's React reader JS fully executes and renders
    //            <img> elements.  Extract images from the fully-rendered DOM.
    //            Fall back to AJAX with the reader page URL as the Referer (required
    //            by MangaFire — sending the site root causes "Request is invalid" 403).
    //   Web:     Fetch static reader HTML via proxy, extract token, then call the
    //            AJAX image endpoint with x-proxy-referer = reader page URL so the
    //            server proxy forwards the correct Referer header.
    try {
      const readerPath = chapterId.startsWith("/") ? chapterId : `/${chapterId}`;
      const fullReaderUrl = `${SITE_URL}${readerPath}`;
      console.log(`[mangafire] getChapterPages: fetching reader page ${readerPath}`);

      let html: string;

      if (Platform.OS !== "web") {
        // Native: navigate the WebView to the reader page so JS can run.
        // 7 s is enough for the React reader to fetch images internally and
        // render <img> elements into the DOM.
        const resp = await webViewBridge.fetchRendered("mangafire", fullReaderUrl, 7000);
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
          return renderedImages;
        }
        console.warn(`[mangafire] Rendered DOM had 0 images — falling back to AJAX (WebView is now back at base URL, Referer will be root)`);
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

      // Extract the chapter session token (data-a attribute on the reader container)
      // e.g. data-a="af266caa520a"
      const tokenM = html.match(/\bdata-a="([a-z0-9]{6,20})"/);
      const token = tokenM?.[1];
      console.log(`[mangafire] getChapterPages: token=${token ?? "not found"} html=${html.length}b`);

      if (token) {
        try {
          // Pass the reader page URL as Referer — without this MangaFire returns
          // {"status":403,"message":"Request is invalid."}.
          // On web: forwarded via x-proxy-referer server-proxy header.
          // On native: the WebView is back at base URL after fetchRendered, so the
          //            automatic Referer will be the site root — same limitation.
          //            The AJAX call still succeeds if the WebView session has
          //            cf_clearance; the Referer check appears relaxed for verified sessions.
          const json = await mfXhrFetch(
            `/ajax/read/${token}/chapter/en`,
            "",
            { refererUrl: fullReaderUrl },
          );
          const images = parseChapterImages(json);
          if (images.length > 0) {
            console.log(`[mangafire] getChapterPages(${chapterId}) AJAX → ${images.length} images`);
            return images;
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

      // HTML fallback: works only when images are embedded in static HTML
      // (rare for MangaFire, but covers edge-case chapters).
      const fallbackImages = parseChapterImagesFromHtml(html);
      if (fallbackImages.length > 0) {
        console.log(`[mangafire] getChapterPages(${chapterId}) HTML fallback → ${fallbackImages.length} images`);
        return fallbackImages;
      }

      console.warn(`[mangafire] PARSER DIAGNOSTIC: getChapterPages(${chapterId}) exhausted all strategies. HTML size: ${html.length}`);
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
