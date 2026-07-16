/**
 * Asura Scans Adapter
 *
 * Implements the MangaSource interface using Asura's first-party REST API
 * (api.asurascans.com) for all metadata and the SSR chapter reader pages
 * (asurascans.com) for image extraction.
 *
 * NO WebView bridge required — the REST API is accessible directly and
 * chapter reader pages are server-side-rendered with image URLs embedded.
 *
 * ── Architecture ──────────────────────────────────────────────────────────
 *
 * apiClient  → api.asurascans.com   (JSON REST API; proxied on web)
 * htmlClient → asurascans.com       (SSR HTML; proxied on web)
 *
 * Manga ID   = slug (e.g. "solo-leveling-ragnarok")
 * Chapter ID = "{slug}::{number}"   (e.g. "solo-leveling-ragnarok::68")
 *
 * ── API endpoints ─────────────────────────────────────────────────────────
 *
 * GET /api/series?page=N&order=update|rating   → { data: AsuraSeries[] }
 * GET /api/search?q={query}                    → { data: AsuraSeries[] }
 * GET /api/series/{slug}                       → { series, recommended_series }
 * GET /api/series/{slug}/chapters              → { data: AsuraChapter[] }
 * SSR /comics/{slug}-a80d257e/chapter/{num}   → HTML with CDN image URLs
 */

import { Manga, Chapter, MangaStatus } from "../types";
import { BaseAdapter } from "../../engine/BaseAdapter";
import { EngineHttpClient } from "../../engine/httpClient";
import { SourceError } from "../../engine";
import {
  AsuraSeriesListResponse,
  AsuraSeriesDetailResponse,
  AsuraSearchResponse,
  AsuraChapterListResponse,
  AsuraSeries,
  AsuraChapter,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

const SITE_URL = "https://asurascans.com";
const API_URL  = "https://api.asurascans.com";

/**
 * All series on asurascans.com share this fixed URL suffix.
 * e.g. public_url = "/comics/solo-leveling-ragnarok-a80d257e"
 */
const PUBLIC_URL_SUFFIX = "-a80d257e";

/** Cache TTLs (ms). */
const TTL = { trending: 120_000, latest: 60_000, search: 300_000, detail: 300_000, chapters: 180_000 } as const;

// ── Status map ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, MangaStatus> = {
  ongoing: "ongoing",
  releasing: "ongoing",
  completed: "completed",
  finished: "completed",
  hiatus: "hiatus",
  dropped: "cancelled",
  cancelled: "cancelled",
  canceled: "cancelled",
};

// ── Image URL regex ────────────────────────────────────────────────────────

/** Matches all Asura CDN chapter image URLs (appears in SSR HTML props + img tags). */
const CDN_IMAGE_RE = /https:\/\/cdn\.asurascans\.com\/asura-images\/chapters\/[^"&\s<>]+\.webp(?:\?[^"&\s<>]*)?/g;

// ── Adapter ────────────────────────────────────────────────────────────────

export class AsuraAdapter extends BaseAdapter {
  readonly id   = "asura";
  readonly name = "Asura Scans";
  readonly baseUrl = SITE_URL;

  requiresVerification = false; // REST API + SSR HTML — no CF JS challenge

  /** REST API client (api.asurascans.com). */
  protected readonly http: EngineHttpClient;

  /** HTML page client (asurascans.com — for chapter reader SSR pages). */
  private readonly htmlClient: EngineHttpClient;

  constructor() {
    super();

    // Both clients share sourceId="asura" for unified health/cookie tracking.
    this.http = this.createHttpClient({
      proxyId: "asura-api",
      siteUrl: API_URL,
      defaultHeaders: {
        Accept: "application/json, text/plain, */*",
        Referer: SITE_URL + "/",
        Origin: SITE_URL,
      },
      timeoutMs: 18_000,
    });

    this.htmlClient = this.createHttpClient({
      proxyId: "asura",
      siteUrl: SITE_URL,
      timeoutMs: 20_000,
    });
  }

  // ── Parsers ────────────────────────────────────────────────────────────────

  /** Map a raw AsuraSeries object → Manga. */
  private mapSeries(s: AsuraSeries): Manga {
    const cover = s.cover ?? s.cover_url ?? "";
    const descRaw = s.description ?? "";
    const descText = descRaw ? this.html.stripTags(this.html.decodeEntities(descRaw)) : undefined;

    return {
      id: s.slug,
      title: s.title,
      coverUrl: cover,
      sourceId: this.id,
      status: STATUS_MAP[s.status?.toLowerCase() ?? ""] as MangaStatus | undefined,
      rating: typeof s.rating === "number" ? Math.round(s.rating * 10) / 10 : undefined,
      description: descText || undefined,
      genres: (s.genres ?? []).map((g) => g.name),
      author: s.author ?? s.artist ?? undefined,
      altTitles: s.alt_titles?.length ? s.alt_titles : undefined,
      chaptersCount: s.chapter_count,
    };
  }

  /** Map a raw AsuraChapter → Chapter. */
  private mapChapter(c: AsuraChapter, mangaSlug: string): Chapter {
    return {
      id: `${mangaSlug}::${c.number}`,
      number: String(c.number),
      title: c.title && c.title.trim() ? c.title.trim() : undefined,
      publishedAt: c.published_at ?? "",
      pages: c.page_count > 0 ? c.page_count : undefined,
    };
  }

  /**
   * Extract chapter page image URLs from the SSR chapter reader HTML.
   * The HTML is served pre-rendered; image URLs appear in both the Astro
   * island props (HTML-entity-encoded) and regular <img> tags.
   */
  private parseChapterPageHtml(html: string): string[] {
    // Decode HTML entities so the regex captures clean URLs from Astro props
    const decoded = this.html.decodeEntities(html);
    const seen = new Set<string>();
    const urls: string[] = [];

    CDN_IMAGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CDN_IMAGE_RE.exec(decoded)) !== null) {
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        urls.push(m[0]);
      }
    }

    return urls;
  }

  // ── MangaSource methods ────────────────────────────────────────────────────

  async getTrending(page = 0): Promise<Manga[]> {
    const cacheKey = `trending:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.http.getJson<AsuraSeriesListResponse>(
        `/api/series?page=${page + 1}&order=rating`,
      );
      const results = (data.data ?? []).map((s) => this.mapSeries(s));
      this.cache.set(cacheKey, results, TTL.trending);
      this.log.log(`getTrending(page=${page}) → ${results.length} series`);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Asura trending failed: ${String(err)}`, "network");
    }
  }

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const cacheKey = `latest:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.http.getJson<AsuraSeriesListResponse>(
        `/api/series?page=${page + 1}&order=update`,
      );
      const results = (data.data ?? []).map((s) => this.mapSeries(s));
      this.cache.set(cacheKey, results, TTL.latest);
      this.log.log(`getLatestUpdates(page=${page}) → ${results.length} series`);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Asura latest failed: ${String(err)}`, "network");
    }
  }

  async search(query: string, page = 0): Promise<Manga[]> {
    const cacheKey = `search:${query.toLowerCase()}:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const q = encodeURIComponent(query.trim());
      const data = await this.http.getJson<AsuraSearchResponse>(`/api/search?q=${q}`);
      const results = (data.data ?? []).map((s) => this.mapSeries(s));
      this.cache.set(cacheKey, results, TTL.search);
      this.log.log(`search("${query}") → ${results.length} results`);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Asura search failed: ${String(err)}`, "network");
    }
  }

  async getMangaDetails(id: string): Promise<Manga> {
    const cacheKey = `detail:${id}`;
    const cached = this.cache.get<Manga>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.http.getJson<AsuraSeriesDetailResponse>(`/api/series/${encodeURIComponent(id)}`);
      const result = this.mapSeries(data.series);
      this.cache.set(cacheKey, result, TTL.detail);
      this.log.log(`getMangaDetails("${id}") → "${result.title}"`);
      return result;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      // Fall back to slug-derived title rather than crashing
      this.log.warn(`getMangaDetails("${id}") failed — returning stub. ${String(err)}`);
      return { id, title: id.replace(/-/g, " "), coverUrl: "", sourceId: this.id };
    }
  }

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    const cacheKey = `chapters:${mangaId}`;
    const cached = this.cache.get<Chapter[]>(cacheKey);
    if (cached) return cached;

    try {
      const data = await this.http.getJson<AsuraChapterListResponse>(
        `/api/series/${encodeURIComponent(mangaId)}/chapters`,
        { signal },
      );
      // API returns chapters newest-first; maintain that order
      const results = (data.data ?? []).map((c) => this.mapChapter(c, mangaId));
      this.cache.set(cacheKey, results, TTL.chapters);
      this.log.log(`getChapters("${mangaId}") → ${results.length} chapters`);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      this.log.warn(`getChapters("${mangaId}") failed: ${String(err)}`);
      return [];
    }
  }

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    // chapterId format: "{mangaSlug}::{chapterNumber}"
    const sep = chapterId.lastIndexOf("::");
    if (sep < 0) {
      this.log.warn(`getChapterPages: unexpected chapterId format "${chapterId}"`);
      return [];
    }

    const mangaSlug   = chapterId.slice(0, sep);
    const chapterNum  = chapterId.slice(sep + 2);

    // Reader URL: /comics/{slug}-a80d257e/chapter/{number}
    const readerPath = `/comics/${mangaSlug}${PUBLIC_URL_SUFFIX}/chapter/${chapterNum}`;
    this.log.log(`getChapterPages → ${readerPath}`);

    try {
      const html = await this.htmlClient.getHtml(readerPath, { signal });

      if (this.html.isCloudflare(html)) {
        throw this.error(
          "Asura chapter page blocked by Cloudflare. Please verify the source.",
          "cloudflare",
          403,
        );
      }

      const urls = this.parseChapterPageHtml(html);
      this.log.log(`getChapterPages("${chapterId}") → ${urls.length} images`);

      if (urls.length === 0) {
        this.log.warn(`No images found in ${readerPath}. HTML size: ${html.length}`);
      }

      return urls;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`Asura chapter pages failed: ${String(err)}`, "network");
    }
  }
}

// Export the singleton adapter instance (matches pattern used by all other sources)
export const asuraSource = new AsuraAdapter();
