/**
 * ComickAdapter — Native adapter for ComicK (comick.io / api.comick.fun)
 *
 * ── Architecture ──────────────────────────────────────────────────────────
 *
 *   api         → api.comick.fun   (primary, CORS-open JSON API)
 *   apiFallback → api.comick.io    (legacy domain, fallback on 404)
 *
 *   Both clients use directOnWeb=true — Comick's CORS headers allow the
 *   browser to hit the API directly. The proxy entries in source-proxy.ts
 *   exist for native fallback / CF-bypass scenarios only.
 *
 * ── Identifiers ───────────────────────────────────────────────────────────
 *
 *   Manga ID   = hid  (stable hash, e.g. "7OKirB3g")
 *   Chapter ID = hid  (stable hash, e.g. "XCdkCCyV")
 *
 * ── API endpoints ─────────────────────────────────────────────────────────
 *
 *   GET /v1.0/search?sort=follow&limit=20&page=N&type=comic   → popular
 *   GET /v1.0/search?sort=uploaded&limit=20&page=N&type=comic → latest
 *   GET /v1.0/search?q={q}&limit=20&page=N&type=comic         → search
 *   GET /comic/{mangaHid}                                      → manga detail
 *   GET /comic/{mangaHid}/chapters?lang=en&limit=300&page=N   → chapter list
 *   GET /chapter/{chapterHid}                                  → chapter pages
 *
 * ── Image CDN ─────────────────────────────────────────────────────────────
 *
 *   Base: https://meo.comick.pictures
 *   Resolution priority: b2key → gpurl → url → name
 *   On web: routed through /api/source-proxy/comick-cdn (adds correct Referer)
 */

import { Manga, Chapter, MangaStatus } from "../types";
import { BaseAdapter } from "../../engine/BaseAdapter";
import { EngineHttpClient } from "../../engine/httpClient";
import { SourceError } from "../../engine";
import type {
  ComickSearchResponse,
  ComickDetailResponse,
  ComickChaptersResponse,
  ComickChapterResponse,
  ComickComic,
  ComickChapter as RawChapter,
  ComickImage,
  ComickGenre,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

const SITE_URL     = "https://comick.io";
const API_URL      = "https://api.comick.fun";
const API_FALLBACK = "https://api.comick.io";
/** CDN base for Backblaze B2 keys and reconstructed name-only URLs. */
const CDN          = "https://meo.comick.pictures";

/** Cache TTLs (ms). */
const TTL = {
  trending: 120_000,
  latest:    60_000,
  search:   300_000,
  detail:   300_000,
  chapters: 180_000,
  pages:    180_000,
} as const;

/** Safety cap: max chapter-list pages to paginate (prevents infinite loops). */
const MAX_CHAPTER_PAGES = 50;

// ── Status map ─────────────────────────────────────────────────────────────

/**
 * Comick encodes publication status as a numeric code:
 *   1 = ongoing, 2 = completed, 3 = cancelled, 4 = hiatus
 */
const STATUS_MAP: Record<number, MangaStatus> = {
  1: "ongoing",
  2: "completed",
  3: "cancelled",
  4: "hiatus",
};

// ── Adapter ────────────────────────────────────────────────────────────────

export class ComickAdapter extends BaseAdapter {
  readonly id      = "comick";
  readonly name    = "Comick";
  readonly baseUrl = SITE_URL;

  requiresVerification = false; // CORS is open — no Cloudflare JS challenge on the API

  /** Primary JSON API client — api.comick.fun. */
  private readonly api: EngineHttpClient;
  /** Fallback JSON API client — api.comick.io (used when primary returns 404). */
  private readonly apiFallback: EngineHttpClient;

  constructor() {
    super();

    const defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      // Comick's API requires the site origin as Referer/Origin for CORS pre-flight
      Referer: SITE_URL + "/",
      Origin:  SITE_URL,
    };

    this.api = this.createHttpClient({
      proxyId: "comick-api",
      siteUrl: API_URL,
      defaultHeaders,
      timeoutMs: 18_000,
    });

    this.apiFallback = this.createHttpClient({
      proxyId: "comick-api-fallback",
      siteUrl: API_FALLBACK,
      defaultHeaders,
      timeoutMs: 18_000,
    });
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Fetch JSON from the Comick API with directOnWeb=true (CORS is open).
   * Falls back to api.comick.io when the primary responds with a 404.
   */
  private async apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
    try {
      return await this.api.getJson<T>(path, { directOnWeb: true, signal });
    } catch (err) {
      if (err instanceof SourceError && err.type === "not_found") {
        this.log.log(`Primary 404 for ${path} — retrying on fallback domain`);
        return this.apiFallback.getJson<T>(path, { directOnWeb: true, signal });
      }
      throw err;
    }
  }

  // ── Parsers ────────────────────────────────────────────────────────────────

  /**
   * Resolve a full image URL from a Comick image object.
   *
   * Priority chain (most reliable → least):
   *   1. b2key  — Backblaze B2 CDN path (most common, most stable in API responses)
   *   2. gpurl  — Google-proxied CDN full URL (must be a non-empty http:// string)
   *   3. url    — Direct full URL
   *   4. name   — Filename only; reconstructed as CDN/{chapterId}/{name}
   */
  private resolveImageUrl(img: ComickImage, chapterId?: string): string {
    // 1. b2key
    if (typeof img.b2key === "string" && img.b2key) {
      return img.b2key.startsWith("http") ? img.b2key : `${CDN}/${img.b2key}`;
    }
    // 2. gpurl — guard against empty string
    if (typeof img.gpurl === "string" && img.gpurl.startsWith("http")) {
      return img.gpurl;
    }
    // 3. url
    if (typeof img.url === "string" && img.url.startsWith("http")) {
      return img.url;
    }
    // 4. name — reconstruct with chapter context
    if (typeof img.name === "string" && img.name) {
      if (img.name.startsWith("http")) return img.name;
      return chapterId ? `${CDN}/${chapterId}/${img.name}` : `${CDN}/${img.name}`;
    }
    return "";
  }

  /**
   * Resolve the cover URL from a comic's md_covers array.
   * Prefers gpurl (full URL) over b2key (CDN path) on the first cover entry.
   */
  private resolveCoverUrl(comic: ComickComic): string {
    const covers = comic.md_covers ?? [];
    const first = covers[0];
    if (!first) return "";

    // gpurl is a full URL but can be empty string — check before using
    if (typeof first.gpurl === "string" && first.gpurl.startsWith("http")) {
      return first.gpurl;
    }
    if (typeof first.b2key === "string" && first.b2key) {
      return first.b2key.startsWith("http") ? first.b2key : `${CDN}/${first.b2key}`;
    }
    return "";
  }

  /**
   * Map a raw Comick comic object → internal Manga.
   *
   * @param comic        - The comic object from the API
   * @param topGenres    - Genres from the detail response top level
   *                       (genres in data.genres, NOT data.comic.genres)
   */
  private mapComic(comic: ComickComic, topGenres?: ComickGenre[]): Manga | null {
    const id = comic.hid ?? comic.slug;
    if (!id || !comic.title) return null;

    // Genre source: top-level wins (detail endpoint); fall back to nested (listings)
    const genreSrc = (topGenres && topGenres.length > 0)
      ? topGenres
      : (comic.genres ?? []);
    const genres = genreSrc.map((g) => g.name).filter(Boolean);

    // Description: strip any HTML tags and decode entities
    const rawDesc = comic.desc ?? comic.parsed ?? "";
    const description = rawDesc
      ? this.html.stripTags(this.html.decodeEntities(rawDesc)).trim()
      : undefined;

    return {
      id,
      title: comic.title,
      coverUrl: this.resolveCoverUrl(comic),
      sourceId: this.id,
      status: STATUS_MAP[comic.status as number] as MangaStatus | undefined,
      rating: comic.rating ? parseFloat(comic.rating) : undefined,
      description: description || undefined,
      genres: genres.length ? genres : undefined,
      year: typeof comic.year === "number" ? comic.year : undefined,
    };
  }

  /** Map a raw Comick chapter → internal Chapter. */
  private mapChapter(c: RawChapter): Chapter | null {
    if (!c.hid) return null;

    const groups = c.group_name ?? [];
    return {
      id: c.hid,
      number: String(c.chap ?? c.chapter ?? "?"),
      title: c.title?.trim() || undefined,
      publishedAt: c.created_at ?? c.updated_at ?? "",
      pages: typeof c.images_count === "number" ? c.images_count : undefined,
      translatedLanguage: "en",
      scanlator: groups.length ? groups.join(", ") : undefined,
    };
  }

  /**
   * Deduplicate chapters by chapter number, keeping the most metadata-rich entry.
   * "Most metadata-rich" = most scanlation group names (longest group_name array).
   */
  private deduplicateChapters(chapters: RawChapter[]): RawChapter[] {
    const seen = new Map<string, RawChapter>();
    for (const c of chapters) {
      const num = String(c.chap ?? c.chapter ?? "?");
      const existing = seen.get(num);
      if (!existing) {
        seen.set(num, c);
        continue;
      }
      const existingScore = (existing.group_name ?? []).length;
      const candidateScore = (c.group_name ?? []).length;
      if (candidateScore > existingScore) seen.set(num, c);
    }
    return Array.from(seen.values());
  }

  // ── Chapter pagination ─────────────────────────────────────────────────────

  /**
   * Fetch all English chapters for a manga by paginating the API.
   *
   * Exit conditions (first wins):
   *   • Empty page returned (no more data)
   *   • all.length >= declared total
   *   • Short page AND no total declared (last page heuristic)
   *   • page > MAX_CHAPTER_PAGES (safety cap)
   */
  private async fetchAllChapters(
    mangaId: string,
    signal?: AbortSignal,
  ): Promise<RawChapter[]> {
    const all: RawChapter[] = [];
    let page = 1;
    const LIMIT = 300;

    while (true) {
      if (signal?.aborted) {
        this.log.log(`getChapters(${mangaId}) aborted at page=${page}`);
        throw new DOMException("Aborted", "AbortError");
      }

      if (page > MAX_CHAPTER_PAGES) {
        this.log.warn(
          `getChapters(${mangaId}) hit MAX_CHAPTER_PAGES at ${all.length} chapters — stopping`,
        );
        break;
      }

      const qs = new URLSearchParams({
        lang:  "en",
        limit: String(LIMIT),
        page:  String(page),
      }).toString();

      const data = await this.apiGet<ComickChaptersResponse>(
        `/comic/${encodeURIComponent(mangaId)}/chapters?${qs}`,
        signal,
      );

      const pageChapters = data.chapters ?? [];
      if (!pageChapters.length) {
        if (page === 1) {
          this.log.warn(`getChapters(${mangaId}) page=1 returned 0 chapters`);
        }
        break;
      }

      all.push(...pageChapters);
      this.log.log(
        `chapters page=${page} +${pageChapters.length} cumulative=${all.length}` +
          (data.total != null ? ` / declared=${data.total}` : ""),
      );

      if (typeof data.total === "number") {
        if (all.length >= data.total) break;
      } else {
        // No total declared: short page → last page
        if (pageChapters.length < LIMIT) break;
      }

      page++;
    }

    return all;
  }

  // ── MangaSource interface ──────────────────────────────────────────────────

  async getTrending(page = 0): Promise<Manga[]> {
    const cacheKey = `trending:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const qs = new URLSearchParams({
        sort: "follow", limit: "20", page: String(page + 1), type: "comic",
      }).toString();
      const data = await this.apiGet<ComickSearchResponse>(`/v1.0/search?${qs}`);
      const items = Array.isArray(data) ? data : [];
      const results = items
        .map((c) => this.mapComic(c))
        .filter((m): m is Manga => m !== null);
      this.log.log(`getTrending(page=${page}) → ${results.length} comics`);
      this.cache.set(cacheKey, results, TTL.trending);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Comick trending failed: ${String(err)}`, "network");
    }
  }

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const cacheKey = `latest:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const qs = new URLSearchParams({
        sort: "uploaded", limit: "20", page: String(page + 1), type: "comic",
      }).toString();
      const data = await this.apiGet<ComickSearchResponse>(`/v1.0/search?${qs}`);
      const items = Array.isArray(data) ? data : [];
      const results = items
        .map((c) => this.mapComic(c))
        .filter((m): m is Manga => m !== null);
      this.log.log(`getLatestUpdates(page=${page}) → ${results.length} comics`);
      this.cache.set(cacheKey, results, TTL.latest);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Comick latest failed: ${String(err)}`, "network");
    }
  }

  async search(query: string, page = 0): Promise<Manga[]> {
    const cacheKey = `search:${query.toLowerCase()}:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const qs = new URLSearchParams({
        q: query.trim(), limit: "20", page: String(page + 1), type: "comic",
      }).toString();
      const data = await this.apiGet<ComickSearchResponse>(`/v1.0/search?${qs}`);
      const items = Array.isArray(data) ? data : [];
      const results = items
        .map((c) => this.mapComic(c))
        .filter((m): m is Manga => m !== null);
      this.log.log(`search("${query}", page=${page}) → ${results.length} results`);
      this.cache.set(cacheKey, results, TTL.search);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Comick search failed: ${String(err)}`, "network");
    }
  }

  async getMangaDetails(id: string): Promise<Manga> {
    const cacheKey = `detail:${id}`;
    const cached = this.cache.get<Manga>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.apiGet<ComickDetailResponse>(
        `/comic/${encodeURIComponent(id)}`,
      );

      // data.comic holds the comic object; data.genres holds the genres (top-level).
      // Never use data.comic.genres — it is usually empty on the detail endpoint.
      const comic = data.comic ?? (data as unknown as ComickComic);
      const result = this.mapComic(comic, data.genres);

      if (!result) {
        throw this.error(
          `ComicK: could not parse manga details for "${id}"`,
          "parse",
        );
      }

      // Enrich with author/artist from the detail-only fields
      const people = [
        ...(data.authors ?? []),
        ...(data.artists ?? []),
      ].map((p) => p.name).filter(Boolean);
      if (people.length) result.author = people[0];

      this.log.log(`getMangaDetails("${id}") → "${result.title}"`);
      this.cache.set(cacheKey, result, TTL.detail);
      return result;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Comick manga details failed: ${String(err)}`, "network");
    }
  }

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    const cacheKey = `chapters:${mangaId}`;
    const cached = this.cache.get<Chapter[]>(cacheKey);
    if (cached) return cached;

    try {
      const rawChapters = await this.fetchAllChapters(mangaId, signal);
      if (!rawChapters.length) return [];

      const deduped = this.deduplicateChapters(rawChapters);
      if (deduped.length !== rawChapters.length) {
        this.log.log(
          `getChapters(${mangaId}) dedup: ${rawChapters.length} → ${deduped.length} chapters`,
        );
      }

      const chapters = deduped
        .map((c) => this.mapChapter(c))
        .filter((c): c is Chapter => c !== null);

      this.log.log(`getChapters("${mangaId}") → ${chapters.length} chapters`);
      this.cache.set(cacheKey, chapters, TTL.chapters);
      return chapters;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      this.log.warn(`getChapters("${mangaId}") failed: ${String(err)}`);
      return [];
    }
  }

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    const cacheKey = `pages:${chapterId}`;
    const cached = this.cache.get<string[]>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.apiGet<ComickChapterResponse>(
        `/chapter/${encodeURIComponent(chapterId)}`,
        signal,
      );

      // Images may be nested inside data.chapter or at data root
      const chapterObj = data.chapter ?? (data as unknown as { images?: ComickImage[] });
      const rawImages = (chapterObj.images ?? data.images ?? []) as ComickImage[];

      if (!rawImages.length) {
        this.log.warn(`getChapterPages("${chapterId}") → 0 images`);
        return [];
      }

      // Diagnostics: log image field distribution
      const b2Count  = rawImages.filter((i) => i.b2key).length;
      const gpCount  = rawImages.filter((i) => i.gpurl).length;
      const urlCount = rawImages.filter((i) => i.url).length;
      this.log.log(
        `getChapterPages("${chapterId}") → ${rawImages.length} images ` +
          `(b2key=${b2Count} gpurl=${gpCount} url=${urlCount})`,
      );

      const urls = rawImages
        .map((img) => this.resolveImageUrl(img, chapterId))
        .filter((u) => u.length > 5)
        // On web: route through server proxy to inject the correct Referer header.
        // CDN_HOST_PROXY_MAP in imageLoader.ts maps meo.comick.pictures → comick-cdn.
        .map((u) => this.images.maybeProxyUrl(u));

      this.log.log(`getChapterPages("${chapterId}") → ${urls.length} resolved URLs`);
      this.cache.set(cacheKey, urls, TTL.pages);
      return urls;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Comick chapter pages failed: ${String(err)}`, "network");
    }
  }
}

// Singleton instance — matches the pattern used by all other source adapters
export const comickSource = new ComickAdapter();
