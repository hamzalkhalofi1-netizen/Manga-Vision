import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";
import { InFlightDedup } from "../network/InFlightDedup";
import { SourceDiagnosticsLogger } from "./SourceDiagnosticsLogger";
import { EngineMemoryCache } from "../engine/memoryCache";

const SITE_URL = "https://comick.io";
// ComicK migrated API domain from comick.io → comick.fun in 2024/2025.
// comick.fun is the live API; comick.io 404s on all endpoints.
const API_URL = "https://api.comick.fun";
const API_URL_FALLBACK = "https://api.comick.io";
const CDN = "https://meo.comick.pictures";

const FETCH_OPTS = {
  sourceId: "comick",
  siteUrl: SITE_URL,
  timeoutMs: 18000,
};

// Module-level diagnostics logger, dedup, and cache instances.
// Dedup: coalesces concurrent identical requests.
// Cache: TTL-based memory cache so back-navigation doesn't re-fetch.
const log = new SourceDiagnosticsLogger("comick");
const dedupManga = new InFlightDedup<Manga[]>();
const dedupDetails = new InFlightDedup<Manga>();
const dedupChapters = new InFlightDedup<Chapter[]>();
const dedupPages = new InFlightDedup<string[]>();
const cache = new EngineMemoryCache(120, 90_000); // 120 entries, 90s TTL

// TTLs (ms) per endpoint — match fetch cadence expectations.
const TTL = {
  trending: 120_000,   // popular lists change slowly
  latest: 60_000,      // latest updates: refresh every minute
  search: 300_000,     // search results: 5 min
  details: 300_000,    // manga details: 5 min
  chapters: 180_000,   // chapter list: 3 min
} as const;

// Max pagination pages (safety cap against infinite loops on bad API responses)
const MAX_CHAPTER_PAGES = 50;

function coverUrl(coverPath: string | undefined): string {
  if (!coverPath) return "";
  if (coverPath.startsWith("http")) return coverPath;
  return `${CDN}/${coverPath}`;
}

function parseComic(item: Record<string, unknown>): Manga | null {
  const mdCovers = (item.md_covers as Array<Record<string, unknown>>) ?? [];
  const firstCover = mdCovers[0];
  const cover = firstCover
    ? coverUrl((firstCover.gpurl ?? firstCover.b2key) as string | undefined)
    : "";

  const genres: string[] = [];
  const tagsRaw = (item.genres as Array<Record<string, unknown>>) ?? [];
  tagsRaw.forEach((t) => { if (t.name) genres.push(t.name as string); });

  let status: Manga["status"] = "ongoing";
  const statusNum = item.status as number | undefined;
  if (statusNum === 2) status = "completed";
  else if (statusNum === 3) status = "cancelled";
  else if (statusNum === 4) status = "hiatus";

  const id = (item.hid ?? item.slug ?? String(item.id ?? "")) as string;
  const title = (item.title ?? item.slug ?? "") as string;
  if (!id || !title) return null;

  return {
    id,
    title,
    coverUrl: cover,
    sourceId: "comick",
    status,
    rating: item.rating ? parseFloat(String(item.rating)) : undefined,
    description: (item.desc ?? item.parsed ?? "") as string,
    genres,
    year: item.year as number | undefined,
  };
}

/**
 * Core fetch for the ComicK API.
 * Uses directOnWeb=true — ComicK has CORS open so the browser hits the API
 * directly (no server proxy needed on web). The server-side proxy is kept
 * in the registry for native fallback / CF-bypass scenarios.
 *
 * @param signal - Optional AbortSignal. Checked before each call; abort stops
 *   the chapter-pagination loop immediately even if the network layer can't
 *   cancel the in-flight request (proxiedFetch manages its own timeout controller).
 */
async function comickFetch(path: string, query = "", signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const t = log.start();
  const displayUrl = `${API_URL}${path}${query}`;

  // Try primary API URL, fall back to legacy domain on 404
  let res: Response;
  try {
    res = await proxiedFetch("comick-api", path, query, {
      ...FETCH_OPTS,
      siteUrl: API_URL,
      directOnWeb: true,
      headers: { Accept: "application/json" },
    });
    // If primary returned 404, try fallback
    if (res.status === 404) {
      log.log(`Primary API 404 for ${path}, trying fallback domain`);
      res = await proxiedFetch("comick-api-fallback", path, query, {
        ...FETCH_OPTS,
        siteUrl: API_URL_FALLBACK,
        directOnWeb: true,
        headers: { Accept: "application/json" },
      });
    }
  } catch (err) {
    if (err instanceof SourceError && err.type === "not_found") {
      // Try fallback domain
      log.log(`Primary fetch failed with not_found, trying fallback`);
      res = await proxiedFetch("comick-api-fallback", path, query, {
        ...FETCH_OPTS,
        siteUrl: API_URL_FALLBACK,
        directOnWeb: true,
        headers: { Accept: "application/json" },
      });
    } else {
      throw err;
    }
  }

  const ct = res.headers.get("content-type") ?? "";
  log.logRequest(displayUrl, res.status, undefined, t);

  if (!ct.includes("application/json") && !ct.includes("text/json")) {
    const body = await res.text();
    const isCF = /just a moment|checking your browser|cf-ray/i.test(body);
    const isNotFound = res.status === 404 || /not.found|404/i.test(body.slice(0, 200));
    log.log(`DIAGNOSTIC: non-JSON response. CF=${isCF} 404=${isNotFound} body[:200]="${body.slice(0, 200)}"`);

    if (isCF) {
      throw new SourceError(
        "ComicK is protected by Cloudflare. Open ComicK in a browser first, then retry.",
        "cloudflare", res.status, "comick"
      );
    }
    if (isNotFound) {
      throw new SourceError(
        `ComicK: resource not found — ${path}`,
        "not_found", res.status, "comick"
      );
    }
    throw new SourceError(
      "ComicK API is currently unavailable — try MangaDex or Asura Scans instead.",
      "upstream", res.status, "comick"
    );
  }

  const json = await res.json();

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const j = json as Record<string, unknown>;
    if (j.result === "error" || j.error) {
      throw new SourceError(
        `ComicK API error: ${j.message ?? j.error ?? "unknown error"}`,
        "upstream", res.status, "comick"
      );
    }
  }

  return json;
}

function requireArray(data: unknown, context: string): Array<Record<string, unknown>> {
  const items = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.result as unknown[]) ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    log.log(`PARSER DIAGNOSTIC: ${context} returned 0 items. data type=${typeof data} isArray=${Array.isArray(data)}`);
  }
  return items as Array<Record<string, unknown>>;
}

/**
 * Construct a full CDN image URL from a ComicK image object.
 *
 * Priority chain (most reliable → least):
 *   1. b2key  — Backblaze B2 CDN key (most common, most stable)
 *   2. gpurl  — Google-proxied CDN URL (fallback for missing b2key)
 *   3. url    — Direct URL if present
 *   4. name   — Filename only; reconstructed with CDN prefix + chapter path
 *
 * Each resolution logs the source type used so diagnostics can detect
 * schema changes if a particular field stops appearing.
 */
function resolveComickImageUrl(img: Record<string, unknown>, chapterId?: string): string {
  // 1. b2key — Backblaze CDN path (most common in API responses)
  if (typeof img.b2key === "string") {
    const key = img.b2key as string;
    const url = key.startsWith("http") ? key : `${CDN}/${key}`;
    log.log(`image via b2key: ${key.slice(0, 60)}`);
    return url;
  }

  // 2. gpurl — Google-proxied CDN URL
  if (typeof img.gpurl === "string" && img.gpurl.startsWith("http")) {
    log.log(`image via gpurl: ${img.gpurl.slice(0, 60)}`);
    return img.gpurl as string;
  }

  // 3. url — Direct full URL
  if (typeof img.url === "string" && img.url.startsWith("http")) {
    log.log(`image via url: ${img.url.slice(0, 60)}`);
    return img.url as string;
  }

  // 4. name — Filename only; reconstruct with chapter context
  if (typeof img.name === "string") {
    const name = img.name as string;
    if (name.startsWith("http")) return name;
    const url = chapterId ? `${CDN}/${chapterId}/${name}` : `${CDN}/${name}`;
    log.log(`image via name (reconstructed): ${name.slice(0, 60)}`);
    return url;
  }

  log.log("image WARN: no resolvable URL field found in image object");
  return "";
}

/**
 * Fetch all chapters for a manga by paginating through the ComicK API.
 *
 * Exit conditions (whichever comes first):
 *   - chapters.length === 0 on current page (no more data)
 *   - all.length >= total (exhausted declared total)
 *   - current page items < limit (last page — short page means no more)
 *   - page > MAX_CHAPTER_PAGES (safety cap against runaway loops)
 *
 * @param signal - AbortSignal; checked before each page fetch so chapter-switch
 *   aborts the loop immediately.
 */
async function fetchAllChapters(mangaId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let page = 1;
  const limit = 300;

  while (true) {
    // Abort: throw so callers see rejection and dedup does not cache partial data
    if (signal?.aborted) {
      log.log(`getChapters(${mangaId}) aborted at page=${page}`);
      throw new DOMException("Aborted", "AbortError");
    }

    // Safety cap: prevent infinite loops on malformed API responses
    if (page > MAX_CHAPTER_PAGES) {
      log.log(`getChapters(${mangaId}) hit MAX_CHAPTER_PAGES (${MAX_CHAPTER_PAGES}) at all.length=${all.length}`);
      break;
    }

    const qs = new URLSearchParams({
      lang: "en",
      limit: String(limit),
      page: String(page),
    }).toString();

    const data = await comickFetch(`/comic/${mangaId}/chapters`, `?${qs}`, signal) as Record<string, unknown>;
    const chapters = (data.chapters as Array<Record<string, unknown>>) ?? [];

    if (!Array.isArray(chapters) || chapters.length === 0) {
      if (page === 1) {
        log.log(`PARSER DIAGNOSTIC: getChapters(${mangaId}) page=${page} → 0. data keys: ${Object.keys(data).slice(0, 8).join(",")}`);
      }
      break;
    }

    log.log(`chapters page=${page} got ${chapters.length}${typeof data.total === "number" ? ` / total=${data.total}` : ""}`);
    all.push(...chapters);

    const total = typeof data.total === "number" ? data.total : null;
    if (total !== null) {
      // When the API declares a total, trust it as the source of truth.
      // A short page alone does NOT stop the loop — intermittent filtering
      // (e.g., server deduplication) can produce short pages mid-series.
      // The max-page cap protects against infinite loops if the total is wrong.
      if (all.length >= total) break;
    } else {
      // No total declared — a short page is the only signal we have.
      if (chapters.length < limit) break;
    }

    page++;
  }

  return all;
}

/**
 * Deduplicate chapters by chapter number, keeping the "best" entry.
 *
 * "Best" = most scanlation group names (longest group_name array means more
 * metadata-rich entry). Falls back to whichever appeared first.
 */
function deduplicateChapters(chapters: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();

  for (const c of chapters) {
    const num = String(c.chap ?? c.chapter ?? "?");
    const existing = seen.get(num);
    if (!existing) {
      seen.set(num, c);
      continue;
    }

    // Prefer the entry with more scanlation group data
    const existingGroups = (existing.group_name as string[] | undefined)?.length ?? 0;
    const candidateGroups = (c.group_name as string[] | undefined)?.length ?? 0;
    if (candidateGroups > existingGroups) {
      seen.set(num, c);
    }
  }

  return Array.from(seen.values());
}

export const comickSource: MangaSource = {
  id: "comick",
  name: "Comick",
  baseUrl: SITE_URL,
  isEnabled: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    const cacheKey = `search:${query}:${page}`;
    const cached = cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    const qs = new URLSearchParams({
      q: query, limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const t = log.start();
    return dedupManga.get(cacheKey, async () => {
      const data = await comickFetch("/v1.0/search", `?${qs}`);
      const items = requireArray(data, `search("${query}")`);
      const results = items.map((d) => parseComic(d)).filter((m): m is Manga => m !== null);
      if (results.length === 0 && items.length > 0) {
        log.log(`PARSER DIAGNOSTIC: items present but 0 parsed. First item keys: ${Object.keys(items[0] ?? {}).slice(0, 8).join(",")}`);
      }
      log.logParsed(`search("${query}")`, results.length, t);
      cache.set(cacheKey, results, TTL.search);
      return results;
    });
  },

  async getTrending(page = 0): Promise<Manga[]> {
    const cacheKey = `trending:${page}`;
    const cached = cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    const qs = new URLSearchParams({
      sort: "follow", limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const t = log.start();
    return dedupManga.get(cacheKey, async () => {
      const data = await comickFetch("/v1.0/search", `?${qs}`);
      const items = requireArray(data, "getTrending");
      const results = items.map((d) => parseComic(d)).filter((m): m is Manga => m !== null);
      if (results.length === 0) log.log("PARSER DIAGNOSTIC: getTrending returned 0 manga.");
      log.logParsed("trending", results.length, t);
      cache.set(cacheKey, results, TTL.trending);
      return results;
    });
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const cacheKey = `latest:${page}`;
    const cached = cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    const qs = new URLSearchParams({
      sort: "uploaded", limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const t = log.start();
    return dedupManga.get(cacheKey, async () => {
      const data = await comickFetch("/v1.0/search", `?${qs}`);
      const items = requireArray(data, "getLatestUpdates");
      const results = items.map((d) => parseComic(d)).filter((m): m is Manga => m !== null);
      if (results.length === 0) log.log("PARSER DIAGNOSTIC: getLatestUpdates returned 0 manga.");
      log.logParsed("latest", results.length, t);
      cache.set(cacheKey, results, TTL.latest);
      return results;
    });
  },

  async getMangaDetails(id: string): Promise<Manga> {
    const cacheKey = `details:${id}`;
    const cached = cache.get<Manga>(cacheKey);
    if (cached) return cached;

    const t = log.start();
    return dedupDetails.get(cacheKey, async () => {
      const data = await comickFetch(`/comic/${id}`) as Record<string, unknown>;

      // The detail endpoint returns { comic: {...}, genres: [...], ... }.
      // Genres are at the TOP level of data, not nested inside data.comic.
      // We merge them into the comic object before parsing so parseComic
      // picks them up correctly via item.genres.
      const comic = (data.comic ?? data) as Record<string, unknown>;
      const topLevelGenres = (data.genres as Array<Record<string, unknown>>) ?? [];
      const mergedComic: Record<string, unknown> = {
        ...comic,
        // Top-level genres win over any stale genres inside comic (usually empty)
        genres: topLevelGenres.length > 0 ? topLevelGenres : ((comic.genres as unknown[]) ?? []),
      };

      const parsed = parseComic(mergedComic);
      if (!parsed) {
        log.log(`PARSER DIAGNOSTIC: getMangaDetails(${id}) failed to parse. keys: ${Object.keys(comic).slice(0, 8).join(",")}`);
        throw new SourceError(`ComicK: could not parse manga details for ${id}`, "upstream", undefined, "comick");
      }
      log.logParsed(`manga-detail`, 1, t);
      cache.set(cacheKey, parsed, TTL.details);
      return parsed;
    });
  },

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    const cacheKey = `chapters:${mangaId}`;
    const cached = cache.get<Chapter[]>(cacheKey);
    if (cached) return cached;

    const t = log.start();
    // Pass signal as BOTH the 3rd arg (per-caller abort — this caller can cancel
    // their wait without killing the shared factory request) AND inside the
    // factory (so the pagination loop itself respects abort signals).
    return dedupChapters.get(cacheKey, async () => {
      const rawChapters = await fetchAllChapters(mangaId, signal);

      if (rawChapters.length === 0) return [];

      // Deduplicate by chapter number, keeping the best-quality scan
      const beforeDedup = rawChapters.length;
      const dedupedRaw = deduplicateChapters(rawChapters);
      if (dedupedRaw.length !== beforeDedup) {
        log.log(`dedup: ${beforeDedup} → ${dedupedRaw.length} chapters (removed ${beforeDedup - dedupedRaw.length} duplicates)`);
      }

      const chapters: Chapter[] = dedupedRaw.map((c) => ({
        id: (c.hid ?? c.id) as string,
        number: String(c.chap ?? c.chapter ?? "?"),
        title: c.title as string | undefined,
        publishedAt: (c.created_at ?? c.updated_at ?? "") as string,
        pages: c.images_count as number | undefined,
        translatedLanguage: "en",
        scanlator: ((c.group_name as string[]) ?? []).join(", ") || undefined,
      })).filter((c) => c.id);

      log.logParsed(`chapters(${mangaId})`, chapters.length, t);
      cache.set(cacheKey, chapters, TTL.chapters);
      return chapters;
    }, signal);
  },

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const cacheKey = `pages:${chapterId}`;
    const cached = cache.get<string[]>(cacheKey);
    if (cached) return cached;

    const t = log.start();
    // Pass signal as 3rd arg (per-caller abort) so one reader leaving the screen
    // doesn't kill a shared in-flight request another screen is waiting on.
    return dedupPages.get(cacheKey, async () => {
      const data = await comickFetch(`/chapter/${chapterId}`, "", signal) as Record<string, unknown>;

      const chapterObj = (data.chapter ?? data) as Record<string, unknown>;
      const images = chapterObj.images ?? data.images ?? [];

      if (!Array.isArray(images) || images.length === 0) {
        log.log(`PARSER DIAGNOSTIC: getChapterPages(${chapterId}) → 0 images. chapter keys: ${Object.keys(chapterObj).slice(0, 8).join(",")}`);
        return [];
      }

      const rawUrls = images as Array<Record<string, unknown>>;
      const urls = rawUrls
        .map((img) => resolveComickImageUrl(img, chapterId))
        .filter((u) => u.length > 5);

      // Log image source type distribution for diagnostics
      const b2Count = rawUrls.filter(i => typeof i.b2key === "string").length;
      const gpCount = rawUrls.filter(i => typeof i.gpurl === "string").length;
      const urlCount = rawUrls.filter(i => typeof i.url === "string").length;
      const nameCount = rawUrls.filter(i => typeof i.name === "string").length;
      log.log(`chapter images: b2key=${b2Count} gpurl=${gpCount} url=${urlCount} name=${nameCount}`);

      log.logParsed(`pages(${chapterId})`, urls.length, t);
      cache.set(cacheKey, urls, TTL.chapters);
      return urls;
    }, signal);
  },
};
