/**
 * tapas.ts — Tapas (tapas.io) source adapter.
 *
 * Tapas is a webtoon/webcomic platform with free and premium content.
 * Only free episodes are accessible without authentication.
 *
 * Strategy:
 *   - Listing/search: HTML scraping of browse/search pages
 *   - Series detail: HTML scraping of /series/{slug} page
 *   - Episode list: try REST API, fall back to HTML scraping
 *   - Images: scrape the episode viewer page
 *
 * Images don't require a special Referer (standard CDN URLs).
 */

import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";
import { InFlightDedup } from "../network/InFlightDedup";
import { SourceDiagnosticsLogger } from "./SourceDiagnosticsLogger";

const SITE_URL = "https://tapas.io";
const SOURCE_ID = "tapas";

const FETCH_OPTS = {
  sourceId: SOURCE_ID,
  siteUrl: SITE_URL,
  timeoutMs: 20000,
  headers: {
    Accept: "text/html,application/xhtml+xml,application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: SITE_URL + "/",
  },
};

const diag = new SourceDiagnosticsLogger(SOURCE_ID);

const dedup = {
  trending: new InFlightDedup<Manga[]>(),
  latest: new InFlightDedup<Manga[]>(),
  search: new InFlightDedup<Manga[]>(),
  detail: new InFlightDedup<Manga>(),
  chapters: new InFlightDedup<Chapter[]>(),
  pages: new InFlightDedup<string[]>(),
};

// ── Fetch helpers ─────────────────────────────────────────────────────────

async function tapasHtml(path: string, query = "", signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const res = await proxiedFetch(SOURCE_ID, path, query, FETCH_OPTS, signal ? { signal } : undefined);
  return res.text();
}

async function tapasJson(path: string, query = "", signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const opts = { ...FETCH_OPTS, headers: { ...FETCH_OPTS.headers, Accept: "application/json, */*" } };
  const res = await proxiedFetch(SOURCE_ID, path, query, opts, signal ? { signal } : undefined);
  return res.json();
}

// ── HTML parsing helpers ──────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Extract manga cards from a Tapas listing/search HTML page.
 *
 * Tapas browse page card format:
 *   <li class="item-component">
 *     <a href="/series/{slug}">
 *       <img class="thumb-img" src="{cover}" alt="{title}">
 *     </a>
 *     <a class="series-name" href="/series/{slug}">{title}</a>
 *   </li>
 *
 * Or within a search results:
 *   <li class="item">
 *     <a href="/series/{slug}">
 *       <img src="{cover}" alt="{title}">
 *       <span class="title">{title}</span>
 *     </a>
 *   </li>
 */
function parseTapasListPage(html: string): Manga[] {
  const results: Manga[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // Strategy 1: <a href="/series/{slug}"> with img and title
  const cardRe = /href="(\/series\/([\w-]+))"[^>]*>[\s\S]{0,600}?<img[^>]+src="([^"]+)"[^>]+alt="([^"]{2,150})"/g;
  while ((m = cardRe.exec(html)) !== null) {
    const [, , slug, cover, title] = m;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    results.push({
      id: slug,
      title: decodeEntities(title.trim()),
      coverUrl: cover,
      sourceId: SOURCE_ID,
    });
  }
  if (results.length > 0) {
    diag.log(`parseTapasListPage s1 → ${results.length}`);
    return results;
  }

  // Strategy 2: img alt + nearby slug href (looser match)
  const slugRe = /href="\/series\/([\w-]+)"/g;
  while ((m = slugRe.exec(html)) !== null) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    const ctx = html.slice(m.index, m.index + 600);
    const coverM = ctx.match(/<img[^>]+src="([^"]+)"/);
    const titleM = ctx.match(/alt="([^"]{2,150})"/) ?? ctx.match(/class="[^"]*title[^"]*"[^>]*>([^<]{2,150})/);
    if (!coverM || !titleM) continue;
    seen.add(slug);
    results.push({
      id: slug,
      title: decodeEntities(titleM[1].trim()),
      coverUrl: coverM[1],
      sourceId: SOURCE_ID,
    });
  }

  diag.log(`parseTapasListPage s2 → ${results.length}`);
  return results;
}

/**
 * Extract episode list from Tapas API response or series page HTML.
 *
 * API response shape (when available):
 *   { data: { episodes: [{ id, title, free, episodeNumber, publishDate }] } }
 */
function parseTapasEpisodes(data: unknown, seriesId: string): Chapter[] {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const episodes =
      (obj.episodes as Array<Record<string, unknown>> | undefined) ??
      ((obj.data as Record<string, unknown>)?.episodes as Array<Record<string, unknown>> | undefined) ??
      [];
    if (episodes.length > 0) {
      return episodes.map((ep) => ({
        id: `${seriesId}/${ep.id ?? ep.episodeId ?? ""}`,
        number: String(ep.episodeNumber ?? ep.sequence ?? ep.number ?? "?"),
        title: ep.title ? String(ep.title) : undefined,
        publishedAt: ep.publishDate ? String(ep.publishDate) : "",
      }));
    }
  }
  return [];
}

/**
 * Extract episode list from series page HTML.
 *
 * Series page episode format:
 *   <a class="episode-item" href="/episode/{id}">
 *     <span class="title">{episode title}</span>
 *   </a>
 */
function parseTapasEpisodesHtml(html: string, seriesId: string): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  const epRe = /href="\/episode\/(\d+)"[^>]*>([\s\S]{0,400}?)<\/a>/g;
  let seq = 1;
  while ((m = epRe.exec(html)) !== null) {
    const epId = m[1];
    if (seen.has(epId)) continue;
    seen.add(epId);
    const inner = m[2];
    const titleM = inner.match(/(?:class="[^"]*(?:title|name)[^"]*"[^>]*>|<span[^>]*>)([^<]{1,200})/);
    const numM = inner.match(/[Ee]pisode\s*(\d+)/);
    chapters.push({
      id: `${seriesId}/${epId}`,
      number: numM?.[1] ?? String(seq),
      title: titleM ? decodeEntities(stripTags(titleM[1]).trim()) : undefined,
      publishedAt: "",
    });
    seq++;
  }
  return chapters;
}

/**
 * Extract images from a Tapas episode viewer page.
 *
 * Format A: <div class="content-scroll"> or <div class="viewer-content">
 *   <img class="img-content" src="...">
 *
 * Format B: JSON embedded in page (Tapas sometimes embeds episode data as JSON)
 */
function parseTapasEpisodeImages(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // Format A: img-content class
  const imgContentRe = /<img[^>]+class="[^"]*(?:img-content|content-img|ep-img)[^"]*"[^>]+src="([^"]+)"/gi;
  while ((m = imgContentRe.exec(html)) !== null) {
    if (!seen.has(m[1]) && m[1].startsWith("http")) { seen.add(m[1]); urls.push(m[1]); }
  }
  if (urls.length > 0) {
    diag.log(`parseTapasEpisodeImages s1 (img-content) → ${urls.length}`);
    return urls;
  }

  // Format B: content-scroll / viewer-content container
  const containerM = html.match(/<div[^>]+class="[^"]*(?:content-scroll|viewer-content|episode-viewer)[^"]*"[^>]*>([\s\S]{0,200000}?)<\/div>/);
  if (containerM) {
    const imgRe = /<img[^>]+src="(https?:\/\/[^"]{10,400}\.(?:jpg|jpeg|png|webp|gif)[^"]*)"/gi;
    while ((m = imgRe.exec(containerM[1])) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
    }
    if (urls.length > 0) {
      diag.log(`parseTapasEpisodeImages s2 (container) → ${urls.length}`);
      return urls;
    }
  }

  // Format C: Any CDN image URL (tapas CDN patterns)
  const cdnRe = /(https?:\/\/[^"'\s]*(?:tapas(?:media|cdn|img|content)|cdn\.tapas)[^"'\s]*\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]*)?)/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  if (urls.length > 0) {
    diag.log(`parseTapasEpisodeImages s3 (cdn) → ${urls.length}`);
    return urls;
  }

  // Format D: any large CDN image (width hint in URL or high-res)
  const anyImgRe = /<img[^>]+src="(https?:\/\/[^"]{20,400}\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((m = anyImgRe.exec(html)) !== null) {
    const u = m[1];
    if (!seen.has(u) && !u.includes("icon") && !u.includes("thumb") && !u.includes("avatar") && !u.includes("logo")) {
      seen.add(u); urls.push(u);
    }
  }

  diag.log(`parseTapasEpisodeImages s4 (fallback) → ${urls.length}`);
  return urls;
}

// ── Source ────────────────────────────────────────────────────────────────

export const tapasSource: MangaSource = {
  id: SOURCE_ID,
  name: "Tapas",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: false,

  async getTrending(page = 0): Promise<Manga[]> {
    return dedup.trending.get(`trending:${page}`, async () => {
      try {
        const qs = page > 0 ? `?page=${page + 1}` : "";
        const html = await tapasHtml("/comics", qs);
        const results = parseTapasListPage(html);
        diag.log(`getTrending p${page} → ${results.length}`);
        if (results.length === 0) diag.log(`WARN: getTrending → 0. HTML size=${html.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Tapas trending failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    return dedup.latest.get(`latest:${page}`, async () => {
      try {
        const qs = new URLSearchParams({
          browse_type: "RECENT",
          ...(page > 0 ? { page: String(page + 1) } : {}),
        }).toString();
        const html = await tapasHtml("/comics", `?${qs}`);
        const results = parseTapasListPage(html);
        diag.log(`getLatestUpdates p${page} → ${results.length}`);
        if (results.length === 0) diag.log(`WARN: getLatestUpdates → 0. HTML size=${html.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Tapas latest failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async search(query: string, page = 0): Promise<Manga[]> {
    return dedup.search.get(`search:${query}:${page}`, async () => {
      try {
        if (!query.trim()) return [];
        const qs = new URLSearchParams({
          q: query,
          type: "COMIC",
          ...(page > 0 ? { page: String(page + 1) } : {}),
        }).toString();
        const html = await tapasHtml("/search", `?${qs}`);
        const results = parseTapasListPage(html);
        diag.log(`search "${query}" p${page} → ${results.length}`);
        if (results.length === 0) diag.log(`WARN: search "${query}" → 0. HTML size=${html.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Tapas search failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getMangaDetails(id: string): Promise<Manga> {
    return dedup.detail.get(`detail:${id}`, async () => {
      try {
        const html = await tapasHtml(`/series/${id}`);
        // Title
        const titleM = html.match(/<h1[^>]+class="[^"]*(?:title|series-name)[^"]*"[^>]*>([^<]{1,200})<\/h1>/) ??
                       html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]{1,200})"/);
        const title = titleM ? decodeEntities(titleM[1].trim()) : id;
        // Cover
        const coverM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ??
                       html.match(/<img[^>]+class="[^"]*thumb[^"]*"[^>]+src="([^"]+)"/);
        const coverUrl = coverM?.[1] ?? "";
        // Description
        const descM = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]{1,2000})"/) ??
                      html.match(/<p[^>]+class="[^"]*(?:desc|synopsis|description)[^"]*"[^>]*>([\s\S]{1,2000}?)<\/p>/);
        const description = descM ? decodeEntities(stripTags(descM[1])).trim() : "";
        // Genres
        const genres: string[] = [];
        const genreRe = /<a[^>]+class="[^"]*(?:genre|tag)[^"]*"[^>]*>([^<]{1,80})<\/a>/g;
        let gm: RegExpExecArray | null;
        while ((gm = genreRe.exec(html)) !== null) genres.push(decodeEntities(gm[1].trim()));

        return { id, title, coverUrl, description, genres, sourceId: SOURCE_ID };
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Tapas getMangaDetails failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    return dedup.chapters.get(`chapters:${mangaId}`, async () => {
      try {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        // Try API first
        try {
          const data = await tapasJson(`/api/series/${mangaId}/episodes`, "", signal);
          const chapters = parseTapasEpisodes(data, mangaId);
          if (chapters.length > 0) {
            diag.log(`getChapters(${mangaId}) API → ${chapters.length}`);
            return chapters;
          }
        } catch {
          diag.log(`getChapters(${mangaId}) API failed, trying HTML`);
        }
        // Fallback: scrape series page
        const html = await tapasHtml(`/series/${mangaId}`, "", signal);
        const chapters = parseTapasEpisodesHtml(html, mangaId);
        diag.log(`getChapters(${mangaId}) HTML → ${chapters.length}`);
        if (chapters.length === 0) diag.log(`WARN: getChapters(${mangaId}) → 0`);
        return chapters;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Tapas getChapters failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    return dedup.pages.get(`pages:${chapterId}`, async () => {
      try {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        // chapterId = "{slug}/{episodeId}"
        const parts = chapterId.split("/");
        const episodeId = parts[parts.length - 1];
        if (!episodeId) {
          diag.log(`WARN: getChapterPages bad chapterId="${chapterId}"`);
          return [];
        }

        // Try API payload endpoint first
        try {
          const data = await tapasJson(`/api/episode/${episodeId}/payload`, "", signal) as Record<string, unknown>;
          const images = (data.images ?? (data.data as Record<string, unknown>)?.images ?? []) as Array<Record<string, unknown>>;
          const urls = images.map((img) => String(img.url ?? img.imageUrl ?? img.src ?? "")).filter(Boolean);
          if (urls.length > 0) {
            diag.log(`getChapterPages(${chapterId}) API → ${urls.length}`);
            return urls;
          }
        } catch {
          diag.log(`getChapterPages(${chapterId}) API payload failed, trying HTML`);
        }

        // Fallback: scrape episode viewer page
        const html = await tapasHtml(`/episode/${episodeId}`, "", signal);
        const images = parseTapasEpisodeImages(html);
        diag.log(`getChapterPages(${chapterId}) HTML → ${images.length}`);
        if (images.length === 0) diag.log(`WARN: getChapterPages(${chapterId}) → 0. HTML size=${html.length}`);
        return images;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Tapas getChapterPages failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },
};
