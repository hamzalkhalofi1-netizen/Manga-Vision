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

const SITE_URL = "https://chapmanganato.to";
const SITE_URL_ALT = "https://manganato.com";
const SOURCE_ID = "kakalot";

const FETCH_OPTS = {
  sourceId: SOURCE_ID,
  siteUrl: SITE_URL,
  timeoutMs: 20000,
  maxRetries: 3,
  headers: {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: SITE_URL + "/",
    "Cache-Control": "no-cache",
    "Upgrade-Insecure-Requests": "1",
  },
};

const FETCH_OPTS_ALT = {
  ...FETCH_OPTS,
  sourceId: "manganato",
  siteUrl: SITE_URL_ALT,
  headers: { ...FETCH_OPTS.headers, Referer: SITE_URL_ALT + "/" },
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

async function kakalotFetch(path: string, query = "", signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  try {
    const res = await proxiedFetch(SOURCE_ID, path, query, FETCH_OPTS, signal ? { signal } : undefined);
    const html = await res.text();
    // If we got an essentially empty response, try the alt domain
    if (html.length < 500) {
      diag.log(`WARN: primary returned short response (${html.length}), trying alt domain`);
      const res2 = await proxiedFetch("manganato", path, query, FETCH_OPTS_ALT, signal ? { signal } : undefined);
      return res2.text();
    }
    return html;
  } catch (err) {
    if (err instanceof SourceError && (err.type === "network" || err.type === "upstream")) {
      diag.log(`Primary domain error: ${err.message}, trying alt domain`);
      // Try alternative domain on network/upstream errors
      const res2 = await proxiedFetch("manganato", path, query, FETCH_OPTS_ALT, signal ? { signal } : undefined);
      return res2.text();
    }
    throw err;
  }
}

/**
 * Encode a search query for chapmanganato.to:
 * spaces → underscores, lowercase, strip special chars.
 */
function encodeSearchQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export const kakalotSource: MangaSource = {
  id: SOURCE_ID,
  name: "MangaKakalot",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: false,

  async getTrending(page = 0): Promise<Manga[]> {
    return dedup.trending.get(`trending:${page}`, async () => {
      try {
        const qs = `?type=topview&state=all&page=${page + 1}`;
        const html = await kakalotFetch("/genre-all", qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`getTrending p${page} → ${results.length}`);
        if (results.length === 0) {
          diag.log(`WARN: getTrending → 0 results. HTML size=${html.length}`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `MangaKakalot trending failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    return dedup.latest.get(`latest:${page}`, async () => {
      try {
        const qs = `?type=newest&state=all&page=${page + 1}`;
        const html = await kakalotFetch("/genre-all", qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`getLatestUpdates p${page} → ${results.length}`);
        if (results.length === 0) {
          diag.log(`WARN: getLatestUpdates → 0 results. HTML size=${html.length}`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `MangaKakalot latest failed: ${err instanceof Error ? err.message : "unknown"}`,
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
        const qs = page > 0 ? `?page=${page + 1}` : "";
        const html = await kakalotFetch(`/search/story/${encoded}`, qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`search "${query}" p${page} → ${results.length}`);
        if (results.length === 0) {
          diag.log(`WARN: search "${query}" → 0. HTML size=${html.length}`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `MangaKakalot search failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getMangaDetails(id: string): Promise<Manga> {
    return dedup.detail.get(`detail:${id}`, async () => {
      try {
        const html = await kakalotFetch(`/${id}`);
        const detail = parseMangaDetail(html);
        return {
          id,
          title: detail.title || id.replace(/^manga-/, "").replace(/-/g, " "),
          coverUrl: detail.coverUrl,
          description: detail.description,
          status: detail.status,
          author: detail.author,
          genres: detail.genres,
          sourceId: SOURCE_ID,
        };
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `MangaKakalot getMangaDetails failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    return dedup.chapters.get(`chapters:${mangaId}`, async () => {
      try {
        const html = await kakalotFetch(`/${mangaId}`, "", signal);
        const chapters = parseChapterList(html);
        diag.log(`getChapters(${mangaId}) → ${chapters.length}`);
        if (chapters.length === 0) {
          diag.log(`WARN: getChapters(${mangaId}) → 0. HTML size=${html.length}`);
        }
        return chapters;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `MangaKakalot getChapters failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    return dedup.pages.get(`pages:${chapterId}`, async () => {
      try {
        const html = await kakalotFetch(`/${chapterId}`, "", signal);
        const images = parseChapterImages(html);
        diag.log(`getChapterPages(${chapterId}) → ${images.length}`);
        if (images.length === 0) {
          diag.log(`WARN: getChapterPages(${chapterId}) → 0. HTML size=${html.length}`);
        }
        return images;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `MangaKakalot getChapterPages failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },
};
