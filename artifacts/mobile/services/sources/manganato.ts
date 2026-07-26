/**
 * Manganato adapter — targets natomanga.com (same backend as MangaKakalot)
 *
 * Manganato / MangaKakalot merged into natomanga.com after chapmanganato.to was squatted (2026).
 * This adapter presents a separate source entry (sourceId = "manganato") to give users an
 * independent feed, following the Mihon extension pattern.
 *
 * URL structure is identical to the kakalot adapter:
 *   Popular  GET /genre/all?type=topview&state=all&page=N
 *   Latest   GET /genre/all?type=latest&state=all&page=N
 *   Search   GET /search/story/{slug-encoded-query}
 *   Detail   GET /manga/{slug}
 *   Chapter  GET /manga/{slug}/chapter-{N}
 *
 * Manga ID   = slug                e.g.  "emperor-of-solo-play"
 * Chapter ID = slug/chapter-N      e.g.  "emperor-of-solo-play/chapter-1"
 */

import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";
import { InFlightDedup } from "../network/InFlightDedup";
import { SourceDiagnosticsLogger } from "./SourceDiagnosticsLogger";
import {
  parseListPage,
  parseMangaDetail,
  parseChapterList,
  parseChapterImages,
} from "./kakalotParser";

const SITE_URL  = "https://www.natomanga.com";
const SOURCE_ID = "manganato";

const FETCH_OPTS = {
  sourceId: SOURCE_ID,
  siteUrl:  SITE_URL,
  timeoutMs: 20_000,
  headers: {
    Accept: "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: SITE_URL + "/",
  },
};

const diag  = new SourceDiagnosticsLogger(SOURCE_ID);

const dedup = {
  trending: new InFlightDedup<Manga[]>(),
  latest:   new InFlightDedup<Manga[]>(),
  search:   new InFlightDedup<Manga[]>(),
  detail:   new InFlightDedup<Manga>(),
  chapters: new InFlightDedup<Chapter[]>(),
  pages:    new InFlightDedup<string[]>(),
};

async function manganatoFetch(
  path: string,
  query  = "",
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const res = await proxiedFetch(SOURCE_ID, path, query, FETCH_OPTS, signal ? { signal } : undefined);
  return res.text();
}

function encodeSearchQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export const manganatoSource: MangaSource = {
  id:   SOURCE_ID,
  name: "Manganato",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: false,

  async getTrending(page = 0): Promise<Manga[]> {
    return dedup.trending.get(`trending:${page}`, async () => {
      try {
        const qs  = `?type=topview&state=all&page=${page + 1}`;
        const html = await manganatoFetch("/genre/all", qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`getTrending p${page} → ${results.length}`);
        if (results.length === 0) diag.log(`WARN: 0 results. HTML size=${html.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganato trending failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    return dedup.latest.get(`latest:${page}`, async () => {
      try {
        const qs  = `?type=latest&state=all&page=${page + 1}`;
        const html = await manganatoFetch("/genre/all", qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`getLatestUpdates p${page} → ${results.length}`);
        if (results.length === 0) diag.log(`WARN: 0 results. HTML size=${html.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganato latest failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async search(query: string, page = 0): Promise<Manga[]> {
    return dedup.search.get(`search:${query}:${page}`, async () => {
      try {
        const encoded = encodeSearchQuery(query);
        if (!encoded) return [];
        const qs   = page > 0 ? `?page=${page + 1}` : "";
        const html = await manganatoFetch(`/search/story/${encoded}`, qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`search "${query}" p${page} → ${results.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganato search failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getMangaDetails(id: string): Promise<Manga> {
    return dedup.detail.get(`detail:${id}`, async () => {
      try {
        const html   = await manganatoFetch(`/manga/${id}`);
        const detail = parseMangaDetail(html);
        return {
          id,
          title:       detail.title || id.replace(/-/g, " "),
          coverUrl:    detail.coverUrl,
          description: detail.description,
          status:      detail.status,
          author:      detail.author,
          genres:      detail.genres,
          sourceId:    SOURCE_ID,
        };
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganato getMangaDetails failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    return dedup.chapters.get(`chapters:${mangaId}`, async () => {
      try {
        const html     = await manganatoFetch(`/manga/${mangaId}`, "", signal);
        const chapters = parseChapterList(html, mangaId);
        diag.log(`getChapters(${mangaId}) → ${chapters.length}`);
        if (chapters.length === 0) diag.log(`WARN: 0 chapters. HTML size=${html.length}`);
        return chapters;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganato getChapters failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    return dedup.pages.get(`pages:${chapterId}`, async () => {
      try {
        const html   = await manganatoFetch(`/manga/${chapterId}`, "", signal);
        const images = parseChapterImages(html);
        diag.log(`getChapterPages(${chapterId}) → ${images.length}`);
        if (images.length === 0) diag.log(`WARN: 0 images. HTML size=${html.length}`);
        return images;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganato getChapterPages failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },
};
