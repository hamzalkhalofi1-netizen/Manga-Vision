/**
 * kakalotParser — Shared HTML parser for natomanga.com (MangaKakalot / Manganato family).
 *
 * natomanga.com is the live successor to chapmanganato.to / manganato.com (both dead as of 2026).
 * HTML structure differs from the old chapmanganato.to template:
 *
 *   Listing:  <div class="item"> cards with img[alt] + a[href=/manga/{slug}][title]
 *   Detail:   <span itemprop="name">, inline author/status/genres, JSON-LD cover
 *             Chapter range extracted from "Start Reading" + "Newest Chapter" links
 *             (full chapter list is AJAX-only; adapter synthesises the range)
 *   Reader:   var chapterImages = [...] JS array (relative paths) OR
 *             <div class="container-chapter-reader"> <img src="https://img-r1.2xstorage.com/...">
 *
 * Chapter images require Referer: https://www.natomanga.com/ to pass hotlink protection.
 *
 * Manga ID   = slug         e.g.  "emperor-of-solo-play"
 * Chapter ID = slug/chapter-N    e.g.  "emperor-of-solo-play/chapter-1"
 */

import { Chapter, Manga, MangaStatus } from "./types";

// ── Utilities ─────────────────────────────────────────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseMangaStatus(raw: string): MangaStatus | undefined {
  const lower = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (lower.includes("ongoing") || lower.includes("publishing")) return "ongoing";
  if (lower.includes("completed") || lower.includes("finished")) return "completed";
  if (lower.includes("hiatus") || lower.includes("onhold") || lower.includes("paused")) return "hiatus";
  if (lower.includes("cancelled") || lower.includes("canceled") || lower.includes("dropped")) return "cancelled";
  return undefined;
}

/**
 * Extract the manga slug from a natomanga.com URL or path.
 *
 * Examples:
 *   "https://www.natomanga.com/manga/emperor-of-solo-play"  → "emperor-of-solo-play"
 *   "/manga/solo-leveling"                                   → "solo-leveling"
 *   "emperor-of-solo-play/chapter-1"                        → "emperor-of-solo-play"
 */
export function extractMangaId(url: string): string {
  const m = url.match(/\/manga\/([^/?#\s]+)/);
  return m ? m[1] : "";
}

// ── Listing page parser ───────────────────────────────────────────────────

/**
 * Parse manga cards from a listing/genre/search HTML page.
 *
 * natomanga.com card structure:
 *   <div class="item">
 *     <img src="https://img-r2.2xstorage.com/thumb/{slug}.webp" alt="{Title}">
 *     <a href="https://www.natomanga.com/manga/{slug}" title="{Title}">
 *       ...
 *     </a>
 *     <a href="https://www.natomanga.com/manga/{slug}/chapter-N">
 *       ...
 *     </a>
 *   </div>
 *
 * Also handles the sidebar "xem-nhieu-item" cards (most popular list).
 */
export function parseListPage(html: string, sourceId: string): Manga[] {
  const results: Manga[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // ── Strategy 1: <div class="item"> cards ────────────────────────────────
  // Split on <div class="item"> boundaries to isolate per-card blocks.
  const itemBlocks = html.split(/<div[^>]+class="[^"]*\bitem\b[^"]*"[^>]*>/);
  for (let i = 1; i < itemBlocks.length; i++) {
    const block = itemBlocks[i].slice(0, 1500);

    // Cover image: first img with src from CDN or thumb
    const imgM = block.match(/<img[^>]+src="(https?:\/\/[^"]{10,400}\.(?:webp|jpg|jpeg|png)[^"]*)"/i);
    const coverUrl = imgM?.[1] ?? "";

    // Title from alt attribute on the img, or title attribute on anchor
    const altM = block.match(/<img[^>]+alt="([^"]{2,200})"/i);
    const titleM = block.match(/href="[^"]*\/manga\/[^"]+"\s+title="([^"]{2,200})"/);
    const rawTitle = altM?.[1] ?? titleM?.[1] ?? "";
    if (!rawTitle) continue;

    // Manga URL: href with /manga/{slug} pattern (exclude chapter links)
    const urlM = block.match(/href="([^"]+\/manga\/([^/"?#\s]{2,200}))"(?![^<]*chapter)/);
    if (!urlM) continue;
    const id = urlM[2];
    if (!id || seen.has(id)) continue;
    seen.add(id);

    results.push({
      id,
      title: decodeEntities(rawTitle.trim()),
      coverUrl,
      sourceId,
    });
  }

  if (results.length > 0) {
    console.log(`[${sourceId}] parseListPage s1 (item cards) → ${results.length}`);
    return results;
  }

  // ── Strategy 2: any /manga/{slug} anchor with title attribute ───────────
  const anchorRe = /href="([^"]+\/manga\/([^/"?#\s]{2,200}))"[^>]*title="([^"]{2,200})"/g;
  while ((m = anchorRe.exec(html)) !== null) {
    const [, , slug, title] = m;
    if (!slug || seen.has(slug) || slug.includes("chapter")) continue;
    const ctx = html.slice(Math.max(0, m.index - 600), m.index + 200);
    const coverM = ctx.match(/<img[^>]+src="(https?:\/\/[^"]{10,400}\.(?:webp|jpg|jpeg|png)[^"]*)"/i);
    seen.add(slug);
    results.push({
      id: slug,
      title: decodeEntities(title.trim()),
      coverUrl: coverM?.[1] ?? "",
      sourceId,
    });
  }

  if (results.length > 0) {
    console.log(`[${sourceId}] parseListPage s2 (anchor-title) → ${results.length}`);
    return results;
  }

  // ── Strategy 3: any /manga/{slug} anchor ───────────────────────────────
  const hrefRe = /href="([^"]+\/manga\/([^/"?#\s]{2,200}))"/g;
  while ((m = hrefRe.exec(html)) !== null) {
    const [, , slug] = m;
    if (!slug || seen.has(slug) || slug.includes("chapter")) continue;
    const ctx = html.slice(m.index, m.index + 600);
    const coverM = ctx.match(/<img[^>]+src="(https?:\/\/[^"]{10,400}\.(?:webp|jpg|jpeg|png)[^"]*)"/i);
    const altM = ctx.match(/<img[^>]+alt="([^"]{2,200})"/i);
    const t = altM?.[1] ?? slug.replace(/-/g, " ");
    seen.add(slug);
    results.push({
      id: slug,
      title: decodeEntities(t.trim()),
      coverUrl: coverM?.[1] ?? "",
      sourceId,
    });
  }

  console.log(`[${sourceId}] parseListPage s3 (href fallback) → ${results.length}`);
  return results;
}

// ── Manga detail parser ───────────────────────────────────────────────────

export interface KakalotMangaDetail {
  title: string;
  description: string;
  coverUrl: string;
  author?: string;
  status?: MangaStatus;
  genres: string[];
}

/**
 * Parse manga detail from a /manga/{slug} page.
 *
 * natomanga.com detail structure:
 *   <span itemprop="name">Title</span>               (preferred)
 *   <h1>Title</h1>                                   (fallback)
 *   <li>Author(s) : Name</li>
 *   <li>Status : Ongoing</li>
 *   <li class="genres">Genres : <a>Genre</a>, ...</li>
 *   og:image meta or JSON-LD "image" field for cover
 */
export function parseMangaDetail(html: string): KakalotMangaDetail {
  // ── Title ──────────────────────────────────────────────────────────────
  // itemprop="name" appears twice on natomanga (site name + manga name)
  // The manga title is always the last one before the chapter list.
  const nameMatches = [...html.matchAll(/<span[^>]+itemprop="name"[^>]*>([^<]{1,200})<\/span>/g)];
  let title = "";
  for (const nm of nameMatches) {
    const candidate = decodeEntities(nm[1].trim());
    if (candidate && candidate !== "Manga Online") {
      title = candidate;
    }
  }
  if (!title) {
    const h1M = html.match(/<h1[^>]*>([^<]{1,200})<\/h1>/);
    title = h1M ? decodeEntities(h1M[1].trim()) : "";
  }

  // ── Cover ──────────────────────────────────────────────────────────────
  // Prefer an inline <img> on the 2xstorage.com CDN (proxy-friendly, no
  // rate-limit issues). Fall back to og:image only when no inline CDN img
  // is found — og:image uses storage.waitst.com which is Cloudflare-rate-
  // limited from server IPs (the API proxy cannot reliably fetch it).
  const thumbM = html.match(/src="(https?:\/\/[^"]+2xstorage\.com\/thumb\/[^"]+)"/i);
  const ogM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
  const jsonM = html.match(/"image"\s*:\s*"([^"]+(?:storage\.waitst\.com|2xstorage\.com)[^"]+)"/);
  const coverUrl = (thumbM?.[1] ?? ogM?.[1] ?? jsonM?.[1] ?? "").trim();

  // ── Author, Status, Genres from <li> elements ──────────────────────────
  let author: string | undefined;
  let status: MangaStatus | undefined;
  const genres: string[] = [];

  // Pattern: <li>Author(s) : Name</li>  or  <li>Status : Ongoing</li>
  const liRe = /<li[^>]*>([\s\S]{0,600}?)<\/li>/g;
  let lm: RegExpExecArray | null;
  while ((lm = liRe.exec(html)) !== null) {
    const text = lm[1];
    const plain = stripTags(decodeEntities(text)).trim();

    if (/author/i.test(plain)) {
      const val = plain.replace(/^Author\s*\(s\)\s*:/i, "").trim();
      if (val && val.length < 200) author = val;
    } else if (/^status\s*:/i.test(plain)) {
      status = parseMangaStatus(plain.replace(/^status\s*:/i, "").trim());
    } else if (/genres?/i.test(text) && text.includes("<a")) {
      const gRe = /<a[^>]*>([^<]{1,80})<\/a>/g;
      let gm: RegExpExecArray | null;
      while ((gm = gRe.exec(text)) !== null) {
        const g = decodeEntities(gm[1].trim());
        if (g && !genres.includes(g)) genres.push(g);
      }
    }
  }

  // ── Description ────────────────────────────────────────────────────────
  // Try panel-story-info-description, then description div, then og:description
  const descM =
    html.match(/<div[^>]+class="[^"]*(?:description|synopsis|summary)[^"]*"[^>]*>([\s\S]{0,5000}?)<\/div>/i) ??
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]{10,1000})"/);
  let description = "";
  if (descM) {
    const inner = descM[1].replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/g, "");
    description = decodeEntities(stripTags(inner)).trim();
  }

  return { title, description, coverUrl, author, status, genres };
}

// ── Chapter list builder ──────────────────────────────────────────────────

/**
 * Extract first and last chapter numbers from a manga detail page.
 *
 * natomanga.com only renders the chapter range server-side:
 *   <a href=".../manga/{slug}/chapter-1" ...>Start Reading</a>
 *   <a href=".../manga/{slug}/chapter-77" ...>Newest Chapter</a>
 *
 * Returns an array of all integer chapter numbers from max down to min.
 */
export function parseChapterList(html: string, mangaId?: string): Chapter[] {
  const seen = new Set<string>();
  const chapters: Chapter[] = [];

  // Try to extract chapter numbers from all /manga/{mangaId}/chapter-N links
  // that belong to THIS manga (filter by mangaId if provided).
  const chRe = mangaId
    ? new RegExp(`href="[^"]+/manga/${mangaId}/chapter-([\\d.]+)[^"]*"`, "g")
    : /href="[^"]+\/manga\/[^"]+\/chapter-([\d.]+)[^"]*"/g;

  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = chRe.exec(html)) !== null) {
    const n = parseFloat(m[1]);
    if (!isNaN(n) && n >= 0) nums.push(n);
  }

  if (nums.length === 0) {
    console.log(`parseChapterList[${mangaId ?? "?"}]: no chapter links found`);
    return [];
  }

  const maxChap = Math.ceil(Math.max(...nums));
  const minChap = Math.floor(Math.min(...nums));

  for (let n = maxChap; n >= minChap; n--) {
    const id = mangaId ? `${mangaId}/chapter-${n}` : `chapter-${n}`;
    if (seen.has(id)) continue;
    seen.add(id);
    chapters.push({
      id,
      number: String(n),
      title: `Chapter ${n}`,
      publishedAt: "",
    });
  }

  console.log(`parseChapterList[${mangaId ?? "?"}]: ${chapters.length} chapters (${minChap}–${maxChap})`);
  return chapters;
}

// ── Chapter image parser ──────────────────────────────────────────────────

const IMG_CDN_BASE = "https://img-r1.2xstorage.com";

/**
 * Parse chapter page image URLs from the reader page.
 *
 * Strategy 1: Parse the JavaScript array injected server-side:
 *   var chapterImages = ["slug\/1\/0.webp", "slug\/1\/1.webp", ...];
 *   Paths are relative → prepend https://img-r1.2xstorage.com/
 *
 * Strategy 2: Parse <div class="container-chapter-reader"> img[src]:
 *   <img src='https://img-r1.2xstorage.com/{slug}/{chapter}/{page}.webp' ...>
 *
 * Strategy 3: Any CDN image URL in the HTML.
 *
 * All images require Referer: https://www.natomanga.com/
 */
export function parseChapterImages(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // ── Strategy 1: var chapterImages = [...] JS array ────────────────────
  const jsM = html.match(/var\s+chapterImages\s*=\s*(\[[\s\S]{1,200000}?\])\s*;/);
  if (jsM) {
    try {
      // The array contains escaped strings like "slug\/1\/0.webp"
      const raw = jsM[1].replace(/\\"/g, '"').replace(/\\'/g, "'");
      const paths: string[] = JSON.parse(raw);
      for (const p of paths) {
        const cleaned = p.replace(/\\\//g, "/").trim();
        if (!cleaned) continue;
        const url = cleaned.startsWith("http") ? cleaned : `${IMG_CDN_BASE}/${cleaned}`;
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
      if (urls.length > 0) {
        console.log(`parseChapterImages s1 (JS array) → ${urls.length}`);
        return urls;
      }
    } catch {
      // Fall through to HTML parsing
    }
  }

  // ── Strategy 2: container-chapter-reader imgs ─────────────────────────
  const containerM = html.match(
    /<div[^>]+class="[^"]*container-chapter-reader[^"]*"[^>]*>([\s\S]{0,500000}?)<\/div>/,
  );
  const source = containerM ? containerM[1] : html;

  const imgRe = /<img[^>]+src='(https?:\/\/[^']{10,400}\.(?:webp|jpg|jpeg|png)[^']*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(source)) !== null) {
    const u = m[1].trim();
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }
  const imgRe2 = /<img[^>]+src="(https?:\/\/[^"]{10,400}\.(?:webp|jpg|jpeg|png)[^"]*)"/gi;
  while ((m = imgRe2.exec(source)) !== null) {
    const u = m[1].trim();
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  if (urls.length > 0) {
    console.log(`parseChapterImages s2 (container-reader) → ${urls.length}`);
    return urls;
  }

  // ── Strategy 3: CDN URLs anywhere in page ────────────────────────────
  const cdnRe = /(https?:\/\/(?:img-r\d+\.2xstorage\.com|imgs-\d+\.2xstorage\.com)[^"'\s]+\.(?:webp|jpg|jpeg|png)(?:\?[^"'\s]*)?)/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    const u = m[1];
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  console.log(`parseChapterImages s3 (CDN fallback) → ${urls.length}`);
  return urls;
}
