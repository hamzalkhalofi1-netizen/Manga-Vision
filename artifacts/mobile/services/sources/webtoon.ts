/**
 * webtoon.ts — WEBTOON (webtoons.com) source adapter.
 *
 * Uses WEBTOON's internal REST APIs (same ones the web app calls).
 * Chapter ID format: "{titleNo}:{episodeNo}" — split on ":" in getChapterPages.
 * Images served from webtoon-phinf.pstatic.net require Referer: https://www.webtoons.com/
 */

import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";
import { InFlightDedup } from "../network/InFlightDedup";
import { SourceDiagnosticsLogger } from "./SourceDiagnosticsLogger";

const SITE_URL = "https://www.webtoons.com";
const SOURCE_ID = "webtoon";

const FETCH_OPTS = {
  sourceId: SOURCE_ID,
  siteUrl: SITE_URL,
  timeoutMs: 20000,
  headers: {
    Accept: "application/json, text/html, */*",
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

// ── Types ─────────────────────────────────────────────────────────────────

type WTitle = {
  titleNo?: number;
  title?: string;
  writingAuthorName?: string;
  representAuthorName?: string;
  thumbnailUrl?: string;
  starScoreAverage?: number;
  genre?: string;
  synopsis?: string;
  publishDescription?: string;
  titleStatus?: string;
};

type WEpisode = {
  episodeNo?: number;
  episodeSeq?: number;
  title?: string;
  registerYmdt?: number;
  registerDate?: string;
  serviceStatus?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function parseWebtoon(t: WTitle): Manga {
  const status = t.titleStatus?.toLowerCase().includes("complete") ? "completed" : "ongoing";
  return {
    id: String(t.titleNo ?? ""),
    title: t.title ?? "Unknown",
    coverUrl: t.thumbnailUrl ?? "",
    sourceId: SOURCE_ID,
    status,
    author: t.writingAuthorName ?? t.representAuthorName,
    rating: t.starScoreAverage,
    genres: t.genre ? [t.genre] : ["Webtoon"],
    description: t.synopsis ?? t.publishDescription ?? "",
  };
}

async function webtoonFetch(path: string, query = "", signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const res = await proxiedFetch(SOURCE_ID, path, query, FETCH_OPTS, signal ? { signal } : undefined);
  return res.json();
}

async function webtoonHtml(path: string, query = "", signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const res = await proxiedFetch(SOURCE_ID, path, query, FETCH_OPTS, signal ? { signal } : undefined);
  return res.text();
}

/**
 * Extract chapter images from the WEBTOON viewer HTML page.
 * Images live in <div class="viewer_lst"> as <img class="p-img" data-url="...">
 * or <img class="p-img" src="..."> — CDN: webtoon-phinf.pstatic.net
 */
function extractViewerImages(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // Primary: data-url attribute (lazy-loaded images)
  const dataUrlRe = /<img[^>]+class="[^"]*p-img[^"]*"[^>]+data-url="([^"]+)"/g;
  while ((m = dataUrlRe.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
  }
  if (urls.length > 0) {
    diag.log(`extractViewerImages: ${urls.length} via data-url`);
    return urls;
  }

  // Secondary: src attribute on p-img class
  const srcRe = /<img[^>]+class="[^"]*p-img[^"]*"[^>]+src="([^"]+)"/g;
  while ((m = srcRe.exec(html)) !== null) {
    if (!seen.has(m[1]) && m[1].startsWith("http")) { seen.add(m[1]); urls.push(m[1]); }
  }
  if (urls.length > 0) {
    diag.log(`extractViewerImages: ${urls.length} via src on p-img`);
    return urls;
  }

  // Tertiary: any pstatic CDN image
  const cdnRe = /(https?:\/\/[^"'\s]+pstatic\.net[^"'\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'\s]*)?)/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    if (!seen.has(m[1]) && !m[1].includes("thumb") && !m[1].includes("icon")) {
      seen.add(m[1]); urls.push(m[1]);
    }
  }

  // Quaternary: viewer_lst img src fallback
  if (urls.length === 0) {
    const viewerM = html.match(/<div[^>]+(?:id|class)="[^"]*viewer_lst[^"]*"[^>]*>([\s\S]{0,200000}?)<\/div>/);
    if (viewerM) {
      const imgRe = /<img[^>]+src="(https?:\/\/[^"]{10,}\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
      while ((m = imgRe.exec(viewerM[1])) !== null) {
        if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
      }
    }
  }

  diag.log(`extractViewerImages fallback: ${urls.length}`);
  return urls;
}

// ── Source ────────────────────────────────────────────────────────────────

export const webtoonSource: MangaSource = {
  id: SOURCE_ID,
  name: "WEBTOON",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: false,

  async getTrending(page = 0): Promise<Manga[]> {
    return dedup.trending.get(`trending:${page}`, async () => {
      try {
        const qs = new URLSearchParams({
          lang: "en",
          sortOrder: "READ_COUNT",
          contentType: "WEBTOON",
          startIndex: String(page * 20 + 1),
          pageSize: "20",
        }).toString();
        const data = await webtoonFetch("/en/api/webtoon/popular/list", `?${qs}`) as Record<string, unknown>;
        const result = data.result as Record<string, unknown> | undefined;
        const items = (result?.titleList ?? []) as WTitle[];
        const results = items.map(parseWebtoon);
        diag.log(`getTrending p${page} → ${results.length}`);
        if (results.length === 0) diag.log(`WARN: getTrending → 0. Trying top/list fallback`);
        if (results.length > 0) return results;
        // Fallback: /en/api/webtoon/top/list
        const data2 = await webtoonFetch("/en/api/webtoon/top/list", `?lang=en&startIndex=1&pageSize=20`) as Record<string, unknown>;
        const r2 = (data2.result as Record<string, unknown>)?.titleList as WTitle[] ?? [];
        diag.log(`getTrending fallback → ${r2.length}`);
        return r2.map(parseWebtoon);
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `WEBTOON trending failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    return dedup.latest.get(`latest:${page}`, async () => {
      try {
        const qs = new URLSearchParams({
          lang: "en",
          sortOrder: "UPDATE",
          contentType: "WEBTOON",
          startIndex: String(page * 20 + 1),
          pageSize: "20",
        }).toString();
        const data = await webtoonFetch("/en/api/webtoon/popular/list", `?${qs}`) as Record<string, unknown>;
        const result = data.result as Record<string, unknown> | undefined;
        const items = (result?.titleList ?? []) as WTitle[];
        const results = items.map(parseWebtoon);
        diag.log(`getLatestUpdates p${page} → ${results.length}`);
        if (results.length === 0) diag.log(`WARN: getLatestUpdates → 0`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `WEBTOON latest failed: ${err instanceof Error ? err.message : "unknown"}`,
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
          query,
          searchType: "WEBTOON",
          startIndex: String(page * 20 + 1),
          pageSize: "20",
        }).toString();
        const data = await webtoonFetch("/en/search", `?${qs}`) as Record<string, unknown>;
        const result = data.result as Record<string, unknown> | undefined;
        const items = (result?.titleList ?? []) as WTitle[];
        const results = items.map(parseWebtoon);
        diag.log(`search "${query}" p${page} → ${results.length}`);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `WEBTOON search failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getMangaDetails(id: string): Promise<Manga> {
    return dedup.detail.get(`detail:${id}`, async () => {
      try {
        const data = await webtoonFetch("/en/api/webtoon/detail", `?titleNo=${id}&lang=en`) as Record<string, unknown>;
        const result = data.result as Record<string, unknown> | undefined;
        const title = result?.webtoonDetail as WTitle | undefined;
        if (title?.titleNo) {
          return parseWebtoon(title);
        }
      } catch (err) {
        if (err instanceof SourceError) throw err;
        diag.log(`getMangaDetails(${id}) API failed, returning stub`);
      }
      return { id, title: "WEBTOON", coverUrl: "", sourceId: SOURCE_ID, description: "" };
    });
  },

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    return dedup.chapters.get(`chapters:${mangaId}`, async () => {
      try {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const allEpisodes: WEpisode[] = [];
        let pageNo = 1;
        // WEBTOON paginates episodes; fetch up to 5 pages (500 episodes)
        while (pageNo <= 5) {
          const qs = new URLSearchParams({
            titleNo: mangaId,
            pageSize: "100",
            pageNo: String(pageNo),
            lang: "en",
          }).toString();
          const data = await webtoonFetch("/en/api/webtoon/episode/list", `?${qs}`, signal) as Record<string, unknown>;
          const result = data.result as Record<string, unknown> | undefined;
          const episodes = (result?.episodeList ?? result?.episodes ?? []) as WEpisode[];
          if (episodes.length === 0) break;
          allEpisodes.push(...episodes);
          if (episodes.length < 100) break; // last page
          pageNo++;
        }
        const chapters: Chapter[] = allEpisodes.map((ep) => ({
          // Chapter ID encodes both titleNo and episodeNo for getChapterPages
          id: `${mangaId}:${ep.episodeNo ?? ep.episodeSeq ?? ""}`,
          number: String(ep.episodeNo ?? ep.episodeSeq ?? "?"),
          title: ep.title,
          publishedAt: ep.registerYmdt
            ? new Date(ep.registerYmdt).toISOString()
            : (ep.registerDate ?? ""),
        }));
        diag.log(`getChapters(${mangaId}) → ${chapters.length}`);
        if (chapters.length === 0) diag.log(`WARN: getChapters(${mangaId}) → 0`);
        return chapters;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `WEBTOON getChapters failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    return dedup.pages.get(`pages:${chapterId}`, async () => {
      try {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        // chapterId = "{titleNo}:{episodeNo}"
        const [titleNo, episodeNo] = chapterId.includes(":")
          ? chapterId.split(":")
          : ["", chapterId];

        if (!titleNo || !episodeNo) {
          diag.log(`WARN: getChapterPages bad chapterId="${chapterId}"`);
          return [];
        }

        const qs = `?title_no=${titleNo}&episode_no=${episodeNo}`;
        const html = await webtoonHtml("/en/viewer", qs, signal);
        const images = extractViewerImages(html);
        diag.log(`getChapterPages(${chapterId}) → ${images.length}`);
        if (images.length === 0) {
          diag.log(`WARN: getChapterPages(${chapterId}) → 0. HTML size=${html.length}`);
        }
        return images;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(
          `WEBTOON getChapterPages failed: ${err instanceof Error ? err.message : "unknown"}`,
          "network", undefined, SOURCE_ID,
        );
      }
    });
  },
};
