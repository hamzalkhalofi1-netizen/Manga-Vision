import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";

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

async function mfXhrFetch(path: string, query = ""): Promise<Record<string, unknown>> {
  const res = await proxiedFetch("mangafire", path, query, XHR_OPTS);
  const json = await res.json() as Record<string, unknown>;
  const status = typeof json.status === "number" ? json.status : 200;
  console.log(`[mangafire] XHR ${path}${query} → status=${status}`);
  if (status === 404) {
    throw new SourceError(`MangaFire: ${path} not found (404)`, "not_found", 404, "mangafire");
  }
  if (status === 403) {
    throw new SourceError(`MangaFire: ${path} blocked (403) — may require session cookies`, "auth", 403, "mangafire");
  }
  return json;
}

// ── HTML parsers ──────────────────────────────────────────────────────────

function isCloudflarePage(html: string): boolean {
  return /just a moment|checking your browser|cf-browser-verification/i.test(html);
}

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

// ── Chapter/page parsing ──────────────────────────────────────────────────

function parseChapters(raw: unknown): Chapter[] {
  // Expected: {status:200, result:{chapters:[{id,number,title,date}]}}
  if (!raw || typeof raw !== "object") return [];
  const json = raw as Record<string, unknown>;
  const result = json.result as Record<string, unknown> | undefined;
  const chapArr = (result?.chapters ?? json.chapters ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(chapArr) || chapArr.length === 0) return [];
  return chapArr.map((c) => ({
    id: String(c.id ?? c.chapter_id ?? ""),
    number: String(c.number ?? c.chapter ?? c.chap ?? "?"),
    title: c.title ? String(c.title) : undefined,
    publishedAt: String(c.date ?? c.created_at ?? c.updated_at ?? ""),
  })).filter((c) => c.id);
}

function parseChapterImages(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const json = raw as Record<string, unknown>;
  const result = json.result as Record<string, unknown> | undefined;
  const images = result?.images ?? json.images ?? result?.pages ?? [];
  if (!Array.isArray(images)) return [];
  return images
    .map((img: unknown) => {
      if (typeof img === "string") return img;
      if (Array.isArray(img) && typeof img[0] === "string") return img[0] as string;
      if (img && typeof img === "object") {
        const o = img as Record<string, unknown>;
        return (o.url ?? o.src ?? o.imageUrl ?? "") as string;
      }
      return "";
    })
    .filter((u) => typeof u === "string" && u.startsWith("http"));
}

// ── Chapter scraping from detail page HTML ─────────────────────────────────

function parseChaptersFromHtml(html: string, mangaId: string): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  // MangaFire chapter links: href="/manga/{slug}/chapter-{n}"
  const re = /href="\/manga\/[\w.-]+\/chapter-([\d.]+)[^"]*"[^>]*data-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, num, chId] = m;
    if (!seen.has(chId)) {
      seen.add(chId);
      chapters.push({ id: chId, number: num, publishedAt: "" });
    }
  }

  if (chapters.length === 0) {
    // Broader fallback: look for chapter link elements
    const re2 = /href="(\/manga\/[\w.-]+\/chapter-[\d.]+[^"]*)"[^>]*>[\s\S]{0,80}?(?:Chapter\s*)?([\d.]+)/g;
    while ((m = re2.exec(html)) !== null) {
      const [, path, num] = m;
      if (!seen.has(path)) {
        seen.add(path);
        // Use path as ID so getChapterPages can reconstruct the URL
        chapters.push({ id: path, number: num, publishedAt: "" });
      }
    }
  }

  console.log(`[mangafire] parseChaptersFromHtml(${mangaId}) → ${chapters.length} chapters`);
  return chapters;
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

  // Pattern 2: JSON-embedded image arrays in scripts
  const scriptRe = /"(?:pages|images|imageUrls?)":\s*\[([^\]]{20,})\]/g;
  while ((m = scriptRe.exec(html)) !== null) {
    const inner = m[1];
    const imgRe2 = /"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe2.exec(inner)) !== null) urls.add(im[1]);
  }

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
    // Try AJAX /home for page 0 (most current content), HTML filter for pages
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
    // /filter?keyword=... returns HTTP 403 from MangaFire for keyword searches.
    // The AJAX search endpoint also returns 403 without a valid session.
    // Best we can do: fetch the filter page and do client-side filtering on
    // the currently visible list. For now, return an explicit diagnostic error
    // so the user sees a useful message instead of an empty screen.
    try {
      const qs = `?keyword=${encodeURIComponent(query)}&page=${page + 1}`;
      const html = await mfHtmlFetch("/filter", qs);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire search blocked by Cloudflare verification.", "cloudflare", 403, "mangafire");
      }
      const results = parseMangaListHtml(html);
      if (results.length > 0) return results;

      // Search returns 403 for keyword — explicit diagnostic
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
    // Try XHR AJAX first — endpoint: /ajax/manga/{id}/chapter/en
    try {
      const json = await mfXhrFetch(`/ajax/manga/${mangaId}/chapter/en`);
      const chapters = parseChapters(json);
      if (chapters.length > 0) {
        console.log(`[mangafire] getChapters(${mangaId}) AJAX → ${chapters.length} chapters`);
        return chapters;
      }
    } catch (err) {
      if (err instanceof SourceError && (err.type === "cloudflare" || err.type === "auth")) throw err;
      console.warn(`[mangafire] AJAX chapter fetch failed for ${mangaId}:`, err);
    }

    // HTML fallback: parse chapter list from manga detail page
    try {
      const html = await mfHtmlFetch(`/manga/${mangaId}`);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire chapter list blocked by Cloudflare.", "cloudflare", 403, "mangafire");
      }
      const chapters = parseChaptersFromHtml(html, mangaId);
      if (chapters.length === 0) {
        console.warn(`[mangafire] PARSER DIAGNOSTIC: getChapters(${mangaId}) HTML fallback → 0. Check chapter link pattern.`);
      }
      return chapters;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    // Try XHR AJAX: /ajax/chapter/{id}
    try {
      const json = await mfXhrFetch(`/ajax/chapter/${chapterId}`);
      const images = parseChapterImages(json);
      if (images.length > 0) {
        console.log(`[mangafire] getChapterPages(${chapterId}) AJAX → ${images.length} images`);
        return images;
      }
    } catch (err) {
      if (err instanceof SourceError && (err.type === "cloudflare" || err.type === "auth")) throw err;
      console.warn(`[mangafire] AJAX page fetch failed for chapter ${chapterId}:`, err);
    }

    // HTML fallback: fetch the reader page and scrape images
    try {
      const path = chapterId.startsWith("/") ? chapterId : `/manga/${chapterId}`;
      const html = await mfHtmlFetch(path);
      if (isCloudflarePage(html)) {
        throw new SourceError("MangaFire reader page blocked by Cloudflare.", "cloudflare", 403, "mangafire");
      }
      const images = parseChapterImagesFromHtml(html);
      if (images.length === 0) {
        console.warn(`[mangafire] PARSER DIAGNOSTIC: getChapterPages(${chapterId}) HTML fallback → 0 images.`);
      }
      return images;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },
};
