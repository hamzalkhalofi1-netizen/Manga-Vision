/**
 * kakalotParser — Shared HTML parser for the MangaKakalot/Manganelo/Manganato family.
 *
 * These sites (chapmanganato.to, readmanganelo.com) share nearly identical HTML:
 *   - Listing: <div class="list-truyen-item-wrap"> or <div class="genres-item"> cards
 *   - Detail:  <div class="story-info-right"> + <ul class="row-content-chapter">
 *   - Reader:  <div class="container-chapter-reader"> with <img> elements
 *
 * All chapter images need Referer: https://chapmanganato.to/ to avoid 403.
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
 * Extract the manga slug-ID from a chapmanganato/readmanganelo URL or path.
 * Returned value is always "manga-{slug}" (the path segment), used as the
 * canonical manga ID across all three adapters.
 *
 * Examples:
 *   "https://chapmanganato.to/manga-ud484"  → "manga-ud484"
 *   "https://readmanganelo.com/manga-aab124" → "manga-aab124"
 *   "/manga-ud484"                          → "manga-ud484"
 */
export function extractMangaId(url: string): string {
  const m = url.match(/\/manga-([\w-]+)/);
  return m ? `manga-${m[1]}` : "";
}

// ── Listing page parser ───────────────────────────────────────────────────

/**
 * Parse manga cards from a listing/search/genre HTML page.
 *
 * Strategy 1: <div class="list-truyen-item-wrap"> — original card format
 *   Inside: <h3><a href="…manga-{id}" title="{title}">
 *            nearby <img src="{cover}">
 *
 * Strategy 2: <div class="genres-item"> — browse/genre pages newer format
 *   Inside: <a href="…manga-{id}" class="…"><img src="{cover}" alt="{title}">
 *
 * Strategy 3: <div class="item"> — search result format
 *   Inside: <a href="…manga-{id}"><img src="{cover}">…<h3>…<a title="{title}">
 *
 * Strategy 4: Bare href fallback
 */
export function parseListPage(html: string, sourceId: string): Manga[] {
  const results: Manga[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // ── Strategy 1: list-truyen-item-wrap ─────────────────────────────────────
  const wrapRe = /<div[^>]+class="[^"]*list-truyen-item-wrap[^"]*"[^>]*>([\s\S]{0,800}?)<\/div>/g;
  while ((m = wrapRe.exec(html)) !== null) {
    const block = m[1];
    const urlM = block.match(/href="([^"]+\/manga-[\w-]+)[^"]*"/);
    const titleM = block.match(/title="([^"]{2,150})"/);
    const coverM = block.match(/<img[^>]+src="([^"]+)"/);
    if (!urlM || !titleM) continue;
    const id = extractMangaId(urlM[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      title: decodeEntities(titleM[1].trim()),
      coverUrl: coverM?.[1] ?? "",
      sourceId,
    });
  }
  if (results.length > 0) {
    console.log(`[${sourceId}] parseListPage s1 (list-truyen-item-wrap) → ${results.length}`);
    return results;
  }

  // ── Strategy 2: genres-item / story_item ──────────────────────────────────
  // Matches: <a href="…/manga-xxx" …><img src="…" alt="{title}">
  const genreRe = /<a[^>]+href="([^"]+\/manga-[\w-]+)[^"]*"[^>]*>[\s\S]{0,300}?<img[^>]+src="([^"]+)"[^>]+alt="([^"]{2,150})"/g;
  while ((m = genreRe.exec(html)) !== null) {
    const [, url, cover, title] = m;
    const id = extractMangaId(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push({ id, title: decodeEntities(title.trim()), coverUrl: cover, sourceId });
  }
  if (results.length > 0) {
    console.log(`[${sourceId}] parseListPage s2 (genres-item/img-alt) → ${results.length}`);
    return results;
  }

  // ── Strategy 3: item-title links with nearby cover ────────────────────────
  const titleLinkRe = /class="[^"]*(?:item-title|story-name|story_name)[^"]*"[^>]*href="([^"]+\/manga-[\w-]+)[^"]*"[^>]*>([^<]{2,150})/g;
  while ((m = titleLinkRe.exec(html)) !== null) {
    const [, url, title] = m;
    const id = extractMangaId(url);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ctx = html.slice(Math.max(0, m.index - 500), m.index + 200);
    const coverM = ctx.match(/<img[^>]+src="([^"]+)"/);
    results.push({ id, title: decodeEntities(title.trim()), coverUrl: coverM?.[1] ?? "", sourceId });
  }
  if (results.length > 0) {
    console.log(`[${sourceId}] parseListPage s3 (item-title links) → ${results.length}`);
    return results;
  }

  // ── Strategy 4: any /manga-{id} anchor with alt text ─────────────────────
  const hrefRe = /href="([^"]+\/manga-([\w-]+))[^"]*"[^>]*(?:title="([^"]{2,150})")?/g;
  while ((m = hrefRe.exec(html)) !== null) {
    const [, url, , title] = m;
    const id = extractMangaId(url);
    if (!id || seen.has(id)) continue;
    const ctx = html.slice(m.index, m.index + 500);
    const coverM = ctx.match(/<img[^>]+src="([^"]+)"/);
    const t = title ?? id.replace(/^manga-/, "").replace(/-/g, " ");
    seen.add(id);
    results.push({ id, title: decodeEntities(t.trim()), coverUrl: coverM?.[1] ?? "", sourceId });
  }
  console.log(`[${sourceId}] parseListPage s4 (href fallback) → ${results.length}`);
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
 * Parse manga detail from a /manga-{id} page.
 *
 * Structure:
 *   <div class="story-info-right">
 *     <h1 itemprop="name">Title</h1>
 *     <table class="variations-tableInfo">
 *       <tr><td class="table-label">Author(s) :</td><td><a>Name</a></td></tr>
 *       <tr><td class="table-label">Status :</td><td>Ongoing</td></tr>
 *       <tr><td class="table-label">Genres :</td><td><a>Genre</a>, ...</td></tr>
 *     </table>
 *   </div>
 *   <div class="panel-story-info-description">
 *     <h3>Way of summary:</h3>
 *     Description text here...
 *   </div>
 */
export function parseMangaDetail(html: string): KakalotMangaDetail {
  // Title
  const titleM =
    html.match(/<h1[^>]+itemprop="name"[^>]*>([^<]{1,200})<\/h1>/) ??
    html.match(/<h1[^>]+class="[^"]*story[^"]*"[^>]*>([^<]{1,200})<\/h1>/) ??
    html.match(/<title>([^<|–-]{1,150})/);
  const title = titleM ? decodeEntities(titleM[1].trim()) : "";

  // Cover
  const coverM = html.match(/<div[^>]+class="[^"]*info-image[^"]*"[^>]*>[\s\S]{0,300}?<img[^>]+src="([^"]+)"/) ??
                 html.match(/<img[^>]+itemprop="image"[^>]+src="([^"]+)"/) ??
                 html.match(/<img[^>]+class="[^"]*info-cover[^"]*"[^>]+src="([^"]+)"/);
  const coverUrl = coverM?.[1] ?? "";

  // Info table rows
  const tableM = html.match(/<table[^>]+class="[^"]*variations-tableInfo[^"]*"[^>]*>([\s\S]{0,2000}?)<\/table>/);
  let author: string | undefined;
  let status: MangaStatus | undefined;
  const genres: string[] = [];

  if (tableM) {
    const table = tableM[1];
    // Each row: <tr><td class="table-label">Label :</td><td class="table-value">Value</td></tr>
    const rowRe = /<tr[^>]*>([\s\S]{0,500}?)<\/tr>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(table)) !== null) {
      const row = rm[1];
      const labelM = row.match(/<td[^>]*class="[^"]*table-label[^"]*"[^>]*>([^<]{1,100})<\/td>/);
      const valueM = row.match(/<td[^>]*class="[^"]*table-value[^"]*"[^>]*>([\s\S]{0,500}?)<\/td>/);
      if (!labelM || !valueM) continue;
      const label = labelM[1].toLowerCase();
      const value = valueM[1];
      if (label.includes("author")) {
        author = stripTags(value).trim() || undefined;
      } else if (label.includes("status")) {
        status = parseMangaStatus(stripTags(value));
      } else if (label.includes("genre")) {
        const genreRe = /<a[^>]+>([^<]{1,80})<\/a>/g;
        let gm: RegExpExecArray | null;
        while ((gm = genreRe.exec(value)) !== null) genres.push(gm[1].trim());
      }
    }
  }

  // Description
  const descM = html.match(
    /<div[^>]+(?:id="panel-story-info-description-more"|class="[^"]*panel-story-info-description[^"]*")[^>]*>([\s\S]{0,3000}?)<\/div>/,
  );
  let description = "";
  if (descM) {
    // Remove inner h3/h4 headers (e.g. "Way of summary:")
    const inner = descM[1].replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/g, "");
    description = decodeEntities(stripTags(inner)).trim();
  }

  return { title, description, coverUrl, author, status, genres };
}

// ── Chapter list parser ───────────────────────────────────────────────────

/**
 * Parse chapter list from a manga detail page.
 *
 * Structure:
 *   <ul class="row-content-chapter">
 *     <li class="a-h">
 *       <a class="chapter-name" href="https://...to/manga-xxx/chapter-N" title="Chapter N: Title">
 *         Chapter N: Title
 *       </a>
 *       <span class="chapter-time text-nowrap" title="{full_date}">{display_date}</span>
 *     </li>
 *   </ul>
 */
export function parseChapterList(html: string): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // Primary: row-content-chapter list items
  const ulM = html.match(/<ul[^>]+class="[^"]*row-content-chapter[^"]*"[^>]*>([\s\S]{0,50000}?)<\/ul>/);
  const source = ulM ? ulM[1] : html;

  const liRe = /<li[^>]*>([\s\S]{0,600}?)<\/li>/g;
  while ((m = liRe.exec(source)) !== null) {
    const li = m[1];
    const linkM = li.match(/href="([^"]+\/manga-[\w-]+\/(chapter-[\d.]+)[^"]*)"/);
    if (!linkM) continue;
    const [, url, chapterSlug] = linkM;

    // Chapter ID: relative path "manga-xxx/chapter-N"
    const pathM = url.match(/\/manga-([\w-]+)\/(chapter-[\d.]+)/);
    if (!pathM) continue;
    const id = `manga-${pathM[1]}/${pathM[2]}`;
    if (seen.has(id)) continue;
    seen.add(id);

    // Number from slug: chapter-42.5 → "42.5"
    const numM = chapterSlug.match(/chapter-([\d.]+)/);
    const number = numM?.[1] ?? chapterSlug;

    // Title from anchor text
    const titleM = li.match(/<a[^>]+class="[^"]*chapter-name[^"]*"[^>]*>([^<]{1,200})<\/a>/);
    const rawTitle = titleM ? decodeEntities(titleM[1].trim()) : "";
    // Remove "Chapter N:" prefix to get clean title
    const cleanTitle = rawTitle.replace(/^Chapter\s*[\d.]+\s*[:\s-]*/i, "").trim() || undefined;

    // Date from span title attribute (prefer full date) or text
    const dateM =
      li.match(/<span[^>]+class="[^"]*chapter-time[^"]*"[^>]+title="([^"]+)"/) ??
      li.match(/<span[^>]+class="[^"]*chapter-time[^"]*"[^>]*>([^<]{4,30})<\/span>/);
    const publishedAt = dateM?.[1]?.trim() ?? "";

    chapters.push({ id, number, title: cleanTitle, publishedAt });
  }

  if (chapters.length > 0) {
    console.log(`parseChapterList: ${chapters.length} chapters from row-content-chapter`);
    return chapters;
  }

  // Fallback: any /manga-xxx/chapter-N href
  const chRe = /href="([^"]+\/manga-([\w-]+)\/(chapter-([\d.]+))[^"]*)"/g;
  while ((m = chRe.exec(html)) !== null) {
    const [, , , , num] = m;
    const pathM2 = m[1].match(/\/manga-([\w-]+)\/(chapter-[\d.]+)/);
    if (!pathM2) continue;
    const id = `manga-${pathM2[1]}/${pathM2[2]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    chapters.push({ id, number: num, publishedAt: "" });
  }
  console.log(`parseChapterList fallback: ${chapters.length} chapters`);
  return chapters;
}

// ── Chapter image parser ──────────────────────────────────────────────────

/**
 * Parse chapter images from the reader page.
 *
 * Structure:
 *   <div class="container-chapter-reader">
 *     <img src="https://s1.mkklcdn.com/…" alt="…" title="…">
 *     …
 *   </div>
 *
 * All images need Referer: https://chapmanganato.to/ (or readmanganelo.com).
 */
export function parseChapterImages(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // Primary: images inside .container-chapter-reader
  const containerM = html.match(
    /<div[^>]+class="[^"]*container-chapter-reader[^"]*"[^>]*>([\s\S]{0,200000}?)<\/div>/,
  );
  const source = containerM ? containerM[1] : html;

  const imgRe = /<img[^>]+src="(https?:\/\/[^"]{10,400}\.(?:jpg|jpeg|png|webp|gif)[^"]*)"/gi;
  while ((m = imgRe.exec(source)) !== null) {
    const u = m[1];
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }

  if (urls.length > 0) {
    console.log(`parseChapterImages: ${urls.length} images from container-chapter-reader`);
    return urls;
  }

  // Fallback: CDN URLs anywhere in the page (mkklcdn, mkkikm, etc.)
  const cdnRe = /(https?:\/\/[^"'\s]+(?:mkklcdn|mkkikm|s\d+\.mkklcdnv2|s\d+\.mkklcnd)[^"'\s]*\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?)/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    const u = m[1];
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  }

  // Fallback 2: data-src / src on page-chapter images
  const pageImgRe = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]{10,400}\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((m = pageImgRe.exec(html)) !== null) {
    const u = m[1];
    if (!seen.has(u) && !u.includes("logo") && !u.includes("icon") && !u.includes("avatar")) {
      seen.add(u); urls.push(u);
    }
  }

  console.log(`parseChapterImages fallback: ${urls.length} images`);
  return urls;
}
