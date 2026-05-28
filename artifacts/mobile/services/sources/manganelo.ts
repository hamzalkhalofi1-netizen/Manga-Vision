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

// readmanganelo.com may be down/blocked. Primary attempts it, then
// immediately falls back to chapmanganato.to (kakalot proxy) on any error
// or empty response. The two sites share the same HTML structure.
const SITE_URL = "https://readmanganelo.com";
const FALLBACK_URL = "https://chapmanganato.to";
const SOURCE_ID = "manganelo";

const FETCH_OPTS = {
  sourceId: SOURCE_ID,
  siteUrl: SITE_URL,
  timeoutMs: 15000,
  maxRetries: 2,
  headers: {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: SITE_URL + "/",
    "Upgrade-Insecure-Requests": "1",
  },
};

const FALLBACK_OPTS = {
  ...FETCH_OPTS,
  sourceId: "kakalot",
  siteUrl: FALLBACK_URL,
  headers: { ...FETCH_OPTS.headers, Referer: FALLBACK_URL + "/" },
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

async function neleloFetch(path: string, query = "", useFallback = false, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const opts = useFallback ? FALLBACK_OPTS : FETCH_OPTS;
  // On fallback, use "kakalot" proxy ID — registered and points to chapmanganato.to.
  // On native the proxy ID is ignored; opts.siteUrl is used directly.
  const proxyId = useFallback ? "kakalot" : SOURCE_ID;
  const res = await proxiedFetch(proxyId, path, query, opts, signal ? { signal } : undefined);
  return res.text();
}

function encodeSearchQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

async function fetchListWithFallback(path: string, query: string, signal?: AbortSignal): Promise<string> {
  try {
    const html = await neleloFetch(path, query, false, signal);
    // Fall back if response is empty or clearly not a manga listing page
    if (html.length < 500 || (!html.includes("manga-") && !html.includes("story"))) {
      diag.log(`Primary returned unusable response (${html.length}), using fallback`);
      return neleloFetch(path, query, true, signal);
    }
    return html;
  } catch (err) {
    diag.log(`Primary domain error: ${err instanceof Error ? err.message : String(err)}, using chapmanganato.to fallback`);
    return neleloFetch(path, query, true, signal);
  }
}

async function fetchDetailWithFallback(mangaId: string, signal?: AbortSignal): Promise<string> {
  try {
    const html = await neleloFetch(`/${mangaId}`, "", false, signal);
    if (html.length > 500) return html;
    return neleloFetch(`/${mangaId}`, "", true, signal);
  } catch {
    return neleloFetch(`/${mangaId}`, "", true, signal);
  }
}

export const manganeloSource: MangaSource = {
  id: SOURCE_ID,
  name: "Manganelo",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: false,

  async getTrending(page = 0): Promise<Manga[]> {
    return dedup.trending.get(`trending:${page}`, async () => {
      try {
        const qs = `?type=topview&state=all&page=${page + 1}`;
        const html = await fetchListWithFallback("/genre-all", qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`getTrending p${page} → ${results.length}`);
        if (results.length === 0) {
          diag.log(`WARN: getTrending → 0 results. HTML size=${html.length}`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganelo trending failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    return dedup.latest.get(`latest:${page}`, async () => {
      try {
        const qs = `?type=newest&state=all&page=${page + 1}`;
        const html = await fetchListWithFallback("/genre-all", qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`getLatestUpdates p${page} → ${results.length}`);
        if (results.length === 0) {
          diag.log(`WARN: getLatestUpdates → 0 results. HTML size=${html.length}`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganelo latest failed: ${err instanceof Error ? err.message : "unknown"}`,
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
        const html = await neleloFetch(`/search/story/${encoded}`, qs);
        const results = parseListPage(html, SOURCE_ID);
        diag.log(`search "${query}" p${page} → ${results.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganelo search failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getMangaDetails(id: string): Promise<Manga> {
    return dedup.detail.get(`detail:${id}`, async () => {
      try {
        const html = await fetchDetailWithFallback(id);
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
          `Manganelo getMangaDetails failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    return dedup.chapters.get(`chapters:${mangaId}`, async () => {
      try {
        const html = await fetchDetailWithFallback(mangaId, signal);
        const chapters = parseChapterList(html);
        diag.log(`getChapters(${mangaId}) → ${chapters.length}`);
        if (chapters.length === 0) {
          diag.log(`WARN: getChapters(${mangaId}) → 0. HTML size=${html.length}`);
        }
        return chapters;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganelo getChapters failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    return dedup.pages.get(`pages:${chapterId}`, async () => {
      try {
        const html = await fetchDetailWithFallback(chapterId, signal);
        const images = parseChapterImages(html);
        diag.log(`getChapterPages(${chapterId}) → ${images.length}`);
        if (images.length === 0) {
          diag.log(`WARN: getChapterPages(${chapterId}) → 0. HTML size=${html.length}`);
        }
        return images;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `Manganelo getChapterPages failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },
};
