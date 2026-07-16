/**
 * BaseAdapter — Abstract base class for all source adapters.
 *
 * Every adapter extends this class and gains access to the full
 * Source Engine toolkit without any boilerplate:
 *
 *   protected html    → HtmlParser  (static HTML utilities)
 *   protected json    → JsonParser  (static JSON utilities)
 *   protected cache   → EngineMemoryCache (per-adapter LRU cache)
 *   protected log     → SourceLogger (scoped to adapter id)
 *   protected images  → ImageLoader (image headers + URL helpers)
 *   protected error() → factory for typed SourceError
 *   protected createHttpClient() → factory for EngineHttpClient
 *
 * Adapters must only implement:
 *   - id, name, baseUrl (identity)
 *   - search / getTrending / getLatestUpdates (discovery)
 *   - getMangaDetails / getChapters / getChapterPages (content)
 *   - their own source-specific parsing methods
 *
 * Nothing else. All infrastructure lives here or in the engine modules.
 */

import { MangaSource, Manga, Chapter } from "../sources/types";
import { EngineHttpClient, HttpClientConfig } from "./httpClient";
import { HtmlParser } from "./htmlParser";
import { JsonParser } from "./jsonParser";
import { EngineMemoryCache } from "./memoryCache";
import { SourceLogger } from "./logger";
import { ImageLoader } from "./imageLoader";
import { SourceError, SourceErrorType } from "./errors";

export abstract class BaseAdapter implements MangaSource {
  // ── Identity (must be provided by each adapter) ─────────────────────────────
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseUrl: string;

  isEnabled: boolean = true;
  requiresVerification: boolean = false;

  // ── Engine toolkit ───────────────────────────────────────────────────────────

  /** Static HTML parsing utilities (entity decode, Cloudflare detect, etc.) */
  protected readonly html = HtmlParser;

  /** Static JSON parsing utilities (safe parse, typed accessors). */
  protected readonly json = JsonParser;

  /**
   * Per-adapter LRU memory cache.
   * Default: 60 entries, 90-second TTL.
   * Override `protected cacheOptions` to customize.
   */
  protected readonly cache = new EngineMemoryCache(60, 90_000);

  /** Cookie + image header utilities. */
  protected readonly images = ImageLoader;

  /** Scoped logger (prefix: `[sourceId]`). Created lazily per call. */
  protected get log(): SourceLogger {
    return new SourceLogger(this.id);
  }

  // ── Factories ────────────────────────────────────────────────────────────────

  /**
   * Create an EngineHttpClient bound to this adapter.
   * `sourceId` is automatically set to `this.id`.
   *
   * Example — API client on a subdomain:
   *   this.api = this.createHttpClient({
   *     proxyId: "my-api",
   *     siteUrl: "https://api.mysite.com",
   *     defaultHeaders: { Accept: "application/json" },
   *   });
   */
  protected createHttpClient(
    config: Omit<HttpClientConfig, "sourceId">,
  ): EngineHttpClient {
    return new EngineHttpClient({ sourceId: this.id, ...config });
  }

  /**
   * Create a typed SourceError attributed to this adapter.
   */
  protected error(
    message: string,
    type: SourceErrorType,
    statusCode?: number,
  ): SourceError {
    return new SourceError(message, type, statusCode, this.id);
  }

  // ── Abstract data methods ────────────────────────────────────────────────────

  abstract search(query: string, page?: number): Promise<Manga[]>;
  abstract getTrending(page?: number): Promise<Manga[]>;
  abstract getLatestUpdates(page?: number): Promise<Manga[]>;
  abstract getMangaDetails(id: string): Promise<Manga>;
  abstract getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]>;
  abstract getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]>;
}
