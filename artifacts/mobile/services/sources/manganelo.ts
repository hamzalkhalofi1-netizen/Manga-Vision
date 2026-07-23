/**
 * MangaGG Adapter — replaces the defunct Manganelo/Kakalot family
 *
 * All original Manganelo/Kakalot domains are either dead (STATUS 000) or
 * domain-squatted (spinzywheel.com / emojilar.com). This adapter targets
 * mangagg.com, a live WordPress + WP-Manga (Madara theme) site that serves
 * English manhwa/manhua with server-side-rendered HTML.
 *
 * Source ID is kept as "manganelo" for backward compatibility.
 *
 * ── Architecture ──────────────────────────────────────────────────────────
 *
 * Single EngineHttpClient → mangagg.com (proxyId: "mangagg")
 * All HTML is server-side rendered — no JavaScript execution required.
 *
 * Manga ID   = slug  (e.g. "heavenly-moon")
 * Chapter ID = "{slug}::chapter-{N}"   (e.g. "heavenly-moon::chapter-268")
 *
 * ── URL patterns ──────────────────────────────────────────────────────────
 *
 * GET /comic/?m_orderby=trending                → trending listing
 * GET /comic/?m_orderby=latest                  → latest updates listing
 * GET /?s={query}&post_type=wp-manga            → search results
 * GET /comic/{slug}/                            → manga detail + chapter links
 * GET /comic/{slug}/chapter-{N}/               → chapter reader (images in HTML)
 *
 * ── Chapter list note ─────────────────────────────────────────────────────
 *
 * The full chapter list on mangagg.com is loaded via JavaScript AJAX
 * (POST /wp-admin/admin-ajax.php) and is blocked server-side for direct
 * requests. The adapter derives a synthetic chapter list by extracting the
 * first and last chapter numbers from the inline HTML links on the detail
 * page and generating all integers in between (descending/newest-first).
 * This is reliable for the integer-numbered series hosted on mangagg.com.
 */

import { Manga, Chapter, MangaStatus } from "./types";
import { BaseAdapter } from "../engine/BaseAdapter";
import { EngineHttpClient } from "../engine/httpClient";
import { SourceError } from "../engine";

// ── Constants ──────────────────────────────────────────────────────────────

const SITE_URL = "https://mangagg.com";

/** Cache TTLs in ms. */
const TTL = {
  trending:  120_000,
  latest:     60_000,
  search:    300_000,
  detail:    300_000,
  chapters:  600_000,
} as const;

const STATUS_MAP: Record<string, MangaStatus> = {
  ongoing:   "ongoing",
  completed: "completed",
  hiatus:    "hiatus",
  dropped:   "cancelled",
  cancelled: "cancelled",
};

// ── Adapter ────────────────────────────────────────────────────────────────

export class MangaggAdapter extends BaseAdapter {
  readonly id      = "manganelo";
  readonly name    = "MangaGG";
  readonly baseUrl = SITE_URL;

  requiresVerification = false;

  protected readonly http: EngineHttpClient;

  constructor() {
    super();
    this.http = this.createHttpClient({
      proxyId: "mangagg",
      siteUrl: SITE_URL,
      defaultHeaders: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeoutMs: 20_000,
    });
  }

  // ── Parsers ────────────────────────────────────────────────────────────────

  /**
   * Parse a WP-Manga Madara listing page (trending / latest / search).
   *
   * Card HTML structure:
   *   <div class="... c-image-hover ..." data-post-id="...">
   *     <a href="https://mangagg.com/comic/{slug}/" title="Manga Title">
   *       <img src="https://mangagg.com/wp-content/..." />
   *     </a>
   *   </div>
   */
  private parseListingHtml(html: string): Manga[] {
    const results: Manga[] = [];
    const seen  = new Set<string>();

    // Split on the anchor class to get per-card blocks
    const blocks = html.split("c-image-hover");
    for (let i = 1; i < blocks.length; i++) {
      const head = blocks[i].slice(0, 1200);

      // href and title (attributes may appear in any order on the <a> tag)
      const hrefM  = head.match(/href="(https:\/\/mangagg\.com\/comic\/([^/"]+)\/)"/);
      const titleM = head.match(/title="([^"]+)"/);
      if (!hrefM || !titleM) continue;

      const slug = hrefM[2];
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      // Cover image: first <img src="…"> that looks like a post thumbnail
      const imgM = head.match(/<img[^>]+src="(https:\/\/mangagg\.com\/wp-content\/[^"]+\.(jpg|jpeg|png|webp)[^"]*?)"/i);
      const coverUrl = imgM ? imgM[1] : "";

      results.push({
        id:       slug,
        title:    this.html.decodeEntities(titleM[1]),
        coverUrl,
        sourceId: this.id,
      });
    }

    return results;
  }

  /**
   * Parse a manga detail page for metadata.
   *
   * Key selectors:
   *   Title       → div.post-title h1
   *   Cover       → JSON-LD "thumbnailUrl" or div.summary_image img[src]
   *   Description → div.summary__content text
   *   Status      → post-content_item containing "Status" → summary-content link text
   *   Author      → post-content_item containing "Author"/"Artist" → link text
   *   Genres      → div.genres-content a (or similar)
   *   ChapCount   → inline chapter hrefs max number
   */
  private parseDetailHtml(html: string, id: string): Manga {
    // ── Title ──────────────────────────────────────────────────────────────
    const titleM = html.match(/<div[^>]*class="post-title[^"]*"[^>]*>[\s\S]{0,300}?<h1[^>]*>([\s\S]{0,300}?)<\/h1>/);
    const title  = titleM
      ? this.html.decodeEntities(this.html.stripTags(titleM[1]).trim())
      : id.replace(/-/g, " ");

    // ── Cover ──────────────────────────────────────────────────────────────
    // JSON-LD thumbnailUrl is the most reliable (appears in all versions)
    const jsonCoverM = html.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/);
    const htmlCoverM = html.match(/class="summary_image[^"]*"[\s\S]{0,500}?<img[^>]+src="([^"]+)"/);
    const coverUrl   = (jsonCoverM?.[1] ?? htmlCoverM?.[1] ?? "").trim();

    // ── Description ────────────────────────────────────────────────────────
    const descM      = html.match(/class="summary__content[^"]*"[^>]*>([\s\S]{0,6000}?)<\/div>/);
    const description = descM
      ? this.html.stripTags(this.html.decodeEntities(descM[1])).replace(/\s+/g, " ").trim() || undefined
      : undefined;

    // ── Status ─────────────────────────────────────────────────────────────
    // Look for a post-content_item row that contains the word "Status"
    const statusBlockM = html.match(/Status[\s\S]{0,200}?class="summary-content[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/i);
    const statusRaw    = statusBlockM
      ? this.html.stripTags(this.html.decodeEntities(statusBlockM[1])).trim().toLowerCase()
      : "";
    const status = (STATUS_MAP[statusRaw] ?? undefined) as MangaStatus | undefined;

    // ── Author ─────────────────────────────────────────────────────────────
    const authorBlockM = html.match(/(?:Author|Artist)[\s\S]{0,200}?class="summary-content[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/i);
    const author = authorBlockM
      ? this.html.stripTags(this.html.decodeEntities(authorBlockM[1])).replace(/\s+/g, " ").trim() || undefined
      : undefined;

    // ── Genres ─────────────────────────────────────────────────────────────
    const genresBlockM = html.match(/class="genres-content[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/i) ||
                         html.match(/Genres?[\s\S]{0,100}?class="summary-content[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/i);
    const genres: string[] = [];
    if (genresBlockM) {
      const gRe = /<a[^>]*>([^<]+)<\/a>/g;
      let gm: RegExpExecArray | null;
      while ((gm = gRe.exec(genresBlockM[1])) !== null) {
        const g = this.html.decodeEntities(gm[1].trim());
        if (g && !genres.includes(g)) genres.push(g);
      }
    }

    // ── Chapter count hint ─────────────────────────────────────────────────
    // Inline HTML reliably shows the first and last chapter links
    const chapterNums = this._extractInlineChapterNums(html, id);
    const maxChapter  = chapterNums.length > 0 ? Math.max(...chapterNums) : undefined;

    return {
      id,
      title,
      coverUrl,
      description,
      status,
      author: author || undefined,
      genres: genres.length > 0 ? genres : undefined,
      chaptersCount: maxChapter ? Math.ceil(maxChapter) : undefined,
      sourceId: this.id,
    };
  }

  /**
   * Extract chapter numbers visible in the inline HTML of a detail page.
   * Only the first (oldest) and last (newest) chapter are rendered server-side.
   */
  private _extractInlineChapterNums(html: string, mangaId: string): number[] {
    const escapedId = mangaId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re  = new RegExp(
      `href="https://mangagg\\.com/comic/${escapedId}/chapter-([\\d]+(?:\\.[\\d]+)?)/"`,"g",
    );
    const nums: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const n = parseFloat(m[1]);
      if (!isNaN(n) && n > 0) nums.push(n);
    }
    return nums;
  }

  /**
   * Build a synthetic chapter list from a manga detail page.
   *
   * WP-Manga's full chapter list is AJAX-only. The detail page HTML always
   * contains at least the first and last chapter href, giving us the range.
   * We generate every integer from max down to min (newest-first).
   */
  private buildChapterList(html: string, mangaId: string): Chapter[] {
    const nums = this._extractInlineChapterNums(html, mangaId);
    if (nums.length === 0) return [];

    const maxChap = Math.ceil(Math.max(...nums));
    const minChap = Math.floor(Math.min(...nums));

    const chapters: Chapter[] = [];
    for (let n = maxChap; n >= minChap; n--) {
      chapters.push({
        id:          `${mangaId}::chapter-${n}`,
        number:      String(n),
        title:       `Chapter ${n}`,
        publishedAt: "",
      });
    }
    return chapters;
  }

  /**
   * Extract chapter page image URLs from a reader page.
   *
   * Images live inside div.reading-content, each in a div.page-break:
   *   <img src=" https://s4.mangagg.com/…" class="wp-manga-chapter-img">
   *
   * The related-reading section that follows also uses wp-manga-chapter-img,
   * so we restrict extraction to the region between "reading-content" and
   * "related-reading" to avoid mixing in unrelated thumbnail images.
   */
  private parseChapterImages(html: string): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();

    // Locate reading-content block
    const rcStart = html.indexOf('"reading-content"');
    if (rcStart < 0) return [];

    // Stop at the related-reading section (or after a generous window)
    const rcEndIdx   = html.indexOf("related-reading", rcStart);
    const readingEnd = rcEndIdx > rcStart ? rcEndIdx : rcStart + 200_000;
    const block      = html.slice(rcStart, readingEnd);

    // src before class: <img … src=" URL " … class="wp-manga-chapter-img …">
    const re1 = /<img[^>]+src="\s*(https?:\/\/[^"]+?)\s*"[^>]*class="[^"]*wp-manga-chapter-img/gi;
    // class before src: <img … class="wp-manga-chapter-img …" … src=" URL ">
    const re2 = /<img[^>]+class="[^"]*wp-manga-chapter-img[^"]*"[^>]*src="\s*(https?:\/\/[^"]+?)\s*"/gi;

    for (const re of [re1, re2]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(block)) !== null) {
        const url = m[1].trim();
        if (url && !seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
    }

    return urls;
  }

  // ── MangaSource methods ────────────────────────────────────────────────────

  async getTrending(page = 0): Promise<Manga[]> {
    const cacheKey = `trending:${page}`;
    const cached   = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const html    = await this.http.getHtml(`/comic/?m_orderby=trending&page=${page + 1}`);
      const results = this.parseListingHtml(html);
      this.cache.set(cacheKey, results, TTL.trending);
      this.log.log(`getTrending(page=${page}) → ${results.length}`);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`MangaGG trending failed: ${String(err)}`, "network");
    }
  }

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const cacheKey = `latest:${page}`;
    const cached   = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const html    = await this.http.getHtml(`/comic/?m_orderby=latest&page=${page + 1}`);
      const results = this.parseListingHtml(html);
      this.cache.set(cacheKey, results, TTL.latest);
      this.log.log(`getLatestUpdates(page=${page}) → ${results.length}`);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`MangaGG latest failed: ${String(err)}`, "network");
    }
  }

  async search(query: string, page = 0): Promise<Manga[]> {
    const cacheKey = `search:${query.toLowerCase()}:${page}`;
    const cached   = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    try {
      const q       = encodeURIComponent(query.trim());
      const html    = await this.http.getHtml(`/?s=${q}&post_type=wp-manga`);
      const results = this.parseListingHtml(html);
      this.cache.set(cacheKey, results, TTL.search);
      this.log.log(`search("${query}") → ${results.length}`);
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`MangaGG search failed: ${String(err)}`, "network");
    }
  }

  async getMangaDetails(id: string): Promise<Manga> {
    const cacheKey = `detail:${id}`;
    const cached   = this.cache.get<Manga>(cacheKey);
    if (cached) return cached;

    try {
      const html = await this.http.getHtml(`/comic/${id}/`);

      if (this.html.isCloudflare(html)) {
        throw this.error(
          "MangaGG blocked by Cloudflare. Please verify the source.",
          "cloudflare", 403,
        );
      }

      const result = this.parseDetailHtml(html, id);
      this.cache.set(cacheKey, result, TTL.detail);
      this.log.log(`getMangaDetails("${id}") → "${result.title}"`);
      return result;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      this.log.warn(`getMangaDetails("${id}") failed: ${String(err)}`);
      return { id, title: id.replace(/-/g, " "), coverUrl: "", sourceId: this.id };
    }
  }

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    const cacheKey = `chapters:${mangaId}`;
    const cached   = this.cache.get<Chapter[]>(cacheKey);
    if (cached) return cached;

    try {
      const html     = await this.http.getHtml(`/comic/${mangaId}/`, { signal });
      const chapters = this.buildChapterList(html, mangaId);
      this.cache.set(cacheKey, chapters, TTL.chapters);
      this.log.log(`getChapters("${mangaId}") → ${chapters.length} chapters (synthetic from inline links)`);
      if (chapters.length === 0) {
        this.log.warn(`getChapters("${mangaId}"): no inline chapter links found. HTML size=${html.length}`);
      }
      return chapters;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      this.log.warn(`getChapters("${mangaId}") failed: ${String(err)}`);
      return [];
    }
  }

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    // chapterId format: "{mangaSlug}::chapter-{N}"
    const sep = chapterId.lastIndexOf("::");
    if (sep < 0) {
      this.log.warn(`getChapterPages: unexpected chapterId format "${chapterId}"`);
      return [];
    }

    const mangaSlug   = chapterId.slice(0, sep);
    const chapterPart = chapterId.slice(sep + 2);
    const readerPath  = `/comic/${mangaSlug}/${chapterPart}/`;
    this.log.log(`getChapterPages → ${readerPath}`);

    try {
      const html = await this.http.getHtml(readerPath, { signal });

      if (this.html.isCloudflare(html)) {
        throw this.error(
          "MangaGG chapter page blocked by Cloudflare. Please verify the source.",
          "cloudflare", 403,
        );
      }

      const urls = this.parseChapterImages(html);
      this.log.log(`getChapterPages("${chapterId}") → ${urls.length} images`);

      if (urls.length === 0) {
        this.log.warn(`No images found in ${readerPath}. HTML size: ${html.length}`);
      }

      return urls;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw this.error(`MangaGG chapter pages failed: ${String(err)}`, "network");
    }
  }
}

// Export singleton — name kept for import compatibility with sources/index.ts
export const manganeloSource = new MangaggAdapter();
