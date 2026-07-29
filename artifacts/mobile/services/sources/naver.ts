/**
 * Naver WEBTOON adapter — webtoons.com (English)
 *
 * Architecture: HTML scraping only.
 * The Webtoons.com internal JSON API returns "Connect Error" from non-whitelisted
 * server IPs (Replit outbound IP is not in NAVER's CDN allowlist).
 * All data is extracted from the publicly accessible HTML pages.
 *
 * ── ID formats ────────────────────────────────────────────────────────────────
 *
 *   Manga ID   : "{genre}/{slug}/{titleNo}"
 *                e.g. "romance/lore-olympus/1320"
 *
 *   Chapter ID : full relative viewer path parsed from the episode list href
 *                e.g. "/en/romance/lore-olympus/episode-1/viewer?title_no=1320&episode_no=1"
 *
 * ── HTML endpoints ────────────────────────────────────────────────────────────
 *
 *   Popular   : GET /en/ranking/trending
 *   Latest    : GET /en/ranking/update
 *   Search    : GET /en/search?keyword={q}
 *   Details   : GET /en/{genre}/{slug}/list?title_no={titleNo}
 *   Chapters  : GET /en/{genre}/{slug}/list?title_no={titleNo}&page={n}
 *   Pages     : GET {chapterId}  (full relative viewer URL from episode list)
 *
 * ── Image CDN ─────────────────────────────────────────────────────────────────
 *
 *   All images are served from webtoon-phinf.pstatic.net.
 *   On web they are automatically rewritten through the "naver-cdn" server proxy
 *   by ImageLoader.maybeProxyUrl(), which injects the required Referer header.
 *
 * ── No shared logic reimplemented ────────────────────────────────────────────
 *
 *   HTTP client   → EngineHttpClient (via BaseAdapter.createHttpClient)
 *   Cache         → EngineMemoryCache (via BaseAdapter.cache)
 *   Dedup         → InFlightDedup
 *   HTML helpers  → HtmlParser (via BaseAdapter.html)
 *   Logging       → SourceLogger (via BaseAdapter.log)
 *   Errors        → SourceError (via BaseAdapter.error)
 *   CF detection  → HtmlParser.isCloudflare (via BaseAdapter.html)
 *   Retry/timeout → EngineHttpClient internals
 *   Image headers → ImageLoader (via BaseAdapter.images)
 */

import { Chapter, Manga } from "./types";
import { BaseAdapter } from "../engine";
import { SourceError } from "../engine";
import { InFlightDedup } from "../network/InFlightDedup";

const SITE_URL = "https://www.webtoons.com";

/** Cache TTLs (ms). */
const TTL = {
  trending:  120_000,
  latest:     60_000,
  search:    300_000,
  detail:    300_000,
  chapters:  180_000,
  pages:      60_000,
} as const;

/** Maximum list pages to fetch when paginating episode lists. */
const MAX_CHAPTER_PAGES = 20;

// ── Adapter ──────────────────────────────────────────────────────────────────

export class NaverAdapter extends BaseAdapter {
  readonly id      = "naver";
  readonly name    = "Naver WEBTOON";
  readonly baseUrl = SITE_URL;

  /** HTTP client configured for webtoons.com through the "naver" server proxy. */
  private readonly http;

  /** Per-endpoint in-flight deduplication (one call per unique key). */
  private readonly dedup = {
    trending: new InFlightDedup<Manga[]>(),
    latest:   new InFlightDedup<Manga[]>(),
    search:   new InFlightDedup<Manga[]>(),
    detail:   new InFlightDedup<Manga>(),
    chapters: new InFlightDedup<Chapter[]>(),
    pages:    new InFlightDedup<string[]>(),
  };

  constructor() {
    super();
    this.http = this.createHttpClient({
      proxyId:  "naver",
      siteUrl:  SITE_URL,
      timeoutMs: 20_000,
      defaultHeaders: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: SITE_URL + "/",
      },
    });
  }

  // ── HTML Parsers ─────────────────────────────────────────────────────────────

  /**
   * Parse webtoon listing cards from ranking or search HTML.
   *
   * Works for both ranking pages (where img alt = title) and search pages
   * (where alt is empty but the title appears in an `.info_text` block).
   *
   * Manga ID = "{genre}/{slug}/{titleNo}" so downstream callers can build
   * /en/{genre}/{slug}/list?title_no={titleNo} without an extra API round-trip.
   */
  private parseCards(html: string): Manga[] {
    const results: Manga[] = [];
    const seen   = new Set<string>();

    // Match anchors that link to a webtoon list page.
    // We capture a generous block after the opening tag to get the img and title.
    const anchorRe =
      /href="https:\/\/www\.webtoons\.com\/en\/([^/"]+)\/([^/"]+)\/list\?title_no=(\d+)"([\s\S]{0,1200}?)(?=href="https:\/\/www\.webtoons\.com|$)/g;

    let m: RegExpExecArray | null;
    anchorRe.lastIndex = 0;

    while ((m = anchorRe.exec(html)) !== null) {
      const [, genre, slug, titleNo, block] = m;
      if (seen.has(titleNo)) continue;
      seen.add(titleNo);

      // Thumbnail: pstatic CDN image in the same block
      const imgMatch = block.match(/src="(https:\/\/webtoon-phinf\.pstatic\.net\/[^"]+)"/);
      const coverUrl = imgMatch?.[1] ?? "";

      // Title: from alt attribute (ranking pages)
      const altMatch = block.match(/\balt="([^"]+)"/);
      let title = altMatch?.[1]?.trim() || "";

      // Title: from .subj or info_text block (search pages where alt is empty)
      if (!title) {
        const subjM =
          block.match(/class="[^"]*subj[^"]*"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{2,})/) ??
          block.match(/class="[^"]*info_text[^"]*"[\s\S]{0,300}?<a[^>]*>([^<]{2,})/);
        title = subjM?.[1]?.trim() || "";
      }

      // Final fallback: derive from slug
      if (!title) {
        title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }

      results.push({
        id:       `${genre}/${slug}/${titleNo}`,
        title:    this.html.decodeEntities(title),
        coverUrl,
        sourceId: this.id,
        status:   "ongoing",
        genres:   [genre.charAt(0).toUpperCase() + genre.slice(1)],
      });
    }

    return results;
  }

  /**
   * Parse episode list items from a series list page HTML.
   *
   * Chapter ID = full relative viewer URL extracted directly from the episode
   * anchor href. This is the most reliable source for the URL since WEBTOON
   * embeds the per-episode slug (e.g. "episode-1") in the path, and there is
   * no simpler canonical redirect URL that works without it.
   */
  private parseEpisodeList(html: string): Chapter[] {
    const chapters: Chapter[] = [];
    const seen    = new Set<string>();

    // Match each episode list item.
    // data-episode-no gives the number; href gives the canonical viewer URL;
    // .subj span gives the title; .date span gives the publish date.
    const epRe =
      /data-episode-no="(\d+)"[\s\S]{0,600}?href="(https:\/\/www\.webtoons\.com\/en[^"]+\/viewer\?[^"]+)"[\s\S]{0,300}?class="subj"[^>]*><span>([^<]*)<\/span>[\s\S]{0,150}?class="date"[^>]*>([^<]*)</g;

    let m: RegExpExecArray | null;
    epRe.lastIndex = 0;

    while ((m = epRe.exec(html)) !== null) {
      const [, episodeNo, href, rawTitle, rawDate] = m;
      if (seen.has(episodeNo)) continue;
      seen.add(episodeNo);

      // Chapter ID is the relative viewer path (strip the domain)
      const viewerPath = href.replace(SITE_URL, "");
      const title      = this.html.decodeEntities(rawTitle?.trim() || `Episode ${episodeNo}`);
      const date       = rawDate?.trim() || "";

      chapters.push({
        id:          viewerPath,
        number:      episodeNo,
        title,
        publishedAt: date,
      });
    }

    return chapters;
  }

  /**
   * Extract all episode panel image URLs from a WEBTOON viewer HTML page.
   *
   * WEBTOON viewer structure:
   *   <div class="viewer_img _img_viewer_area">
   *     <img class="_images" data-url="https://webtoon-phinf.pstatic.net/..." ...>
   *   </div>
   *
   * Episode navigation thumbnails use class="_thumbnailImages" (NOT "_images").
   * Falls through to src attribute then CDN hostname regex as further fallbacks.
   */
  private parseViewerImages(html: string): string[] {
    const urls: string[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;

    // Primary: data-url on ._images elements (the main viewer panel images).
    // These are in the viewer_img container. Navigation thumbnails use "_thumbnailImages".
    const dataUrlRe = /<img[^>]+class="[^"]*_images[^"]*"[^>]+data-url="([^"]+)"/g;
    dataUrlRe.lastIndex = 0;
    while ((m = dataUrlRe.exec(html)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
    }
    if (urls.length > 0) {
      this.log.log(`parseViewerImages: ${urls.length} via ._images data-url`);
      return urls;
    }

    // Secondary: data-url on deprecated .p-img elements (older WEBTOON layouts)
    const pImgRe = /<img[^>]+class="[^"]*p-img[^"]*"[^>]+data-url="([^"]+)"/g;
    pImgRe.lastIndex = 0;
    while ((m = pImgRe.exec(html)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
    }
    if (urls.length > 0) {
      this.log.log(`parseViewerImages: ${urls.length} via .p-img data-url`);
      return urls;
    }

    // Tertiary: src attribute on ._images elements (no lazy-load)
    const srcRe = /<img[^>]+class="[^"]*_images[^"]*"[^>]+src="(https?:\/\/webtoon-phinf[^"]+)"/g;
    srcRe.lastIndex = 0;
    while ((m = srcRe.exec(html)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); }
    }
    if (urls.length > 0) {
      this.log.log(`parseViewerImages: ${urls.length} via ._images src`);
      return urls;
    }

    // Quaternary: viewer_lst container — any CDN image that is NOT a thumbnail
    // (thumbnails use "_thumbnailImages" class; panel images do NOT have thumb_ prefix)
    const viewerContM = html.match(/<div[^>]+class="[^"]*viewer_img[^"]*"[^>]*>([\s\S]{0,500000}?)<\/div>/);
    if (viewerContM) {
      const cdnRe =
        /(https:\/\/webtoon-phinf\.pstatic\.net\/[^"'\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'\s]*)?)/gi;
      cdnRe.lastIndex = 0;
      while ((m = cdnRe.exec(viewerContM[1])) !== null) {
        const u = m[1];
        if (!seen.has(u) && !u.includes("thumb_")) {
          seen.add(u); urls.push(u);
        }
      }
      if (urls.length > 0) {
        this.log.log(`parseViewerImages: ${urls.length} via viewer_img CDN`);
        return urls;
      }
    }

    // Final fallback: any pstatic CDN URL in the page that isn't a thumbnail
    const fullCdnRe =
      /(https:\/\/webtoon-phinf\.pstatic\.net\/[^"'\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'\s]*)?)/gi;
    fullCdnRe.lastIndex = 0;
    while ((m = fullCdnRe.exec(html)) !== null) {
      const u = m[1];
      if (!seen.has(u) && !u.includes("thumb_") && !u.includes("type=f160")) {
        seen.add(u); urls.push(u);
      }
    }

    this.log.log(`parseViewerImages: ${urls.length} via global CDN fallback`);
    return urls;
  }

  // ── MangaSource methods ──────────────────────────────────────────────────────

  async getTrending(page = 0): Promise<Manga[]> {
    const cacheKey = `trending:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    return this.dedup.trending.get(cacheKey, async () => {
      try {
        const html = await this.http.getHtml("/en/ranking/trending");
        const results = this.parseCards(html);
        this.log.log(`getTrending(page=${page}) → ${results.length}`);
        if (results.length === 0) this.log.warn("getTrending → 0 results (HTML changed?)");
        else this.cache.set(cacheKey, results, TTL.trending);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw this.error(`Naver trending failed: ${String(err)}`, "network");
      }
    });
  }

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const cacheKey = `latest:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    return this.dedup.latest.get(cacheKey, async () => {
      try {
        const html = await this.http.getHtml("/en/ranking/update");
        const results = this.parseCards(html);
        this.log.log(`getLatestUpdates(page=${page}) → ${results.length}`);
        if (results.length === 0) this.log.warn("getLatestUpdates → 0 results (HTML changed?)");
        else this.cache.set(cacheKey, results, TTL.latest);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw this.error(`Naver latest failed: ${String(err)}`, "network");
      }
    });
  }

  async search(query: string, page = 0): Promise<Manga[]> {
    if (!query.trim()) return [];
    const cacheKey = `search:${query.toLowerCase()}:${page}`;
    const cached = this.cache.get<Manga[]>(cacheKey);
    if (cached) return cached;

    return this.dedup.search.get(cacheKey, async () => {
      try {
        const q    = encodeURIComponent(query.trim());
        const html = await this.http.getHtml(`/en/search?keyword=${q}`);
        const results = this.parseCards(html);
        this.log.log(`search("${query}", page=${page}) → ${results.length}`);
        if (results.length > 0) this.cache.set(cacheKey, results, TTL.search);
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw this.error(`Naver search failed: ${String(err)}`, "network");
      }
    });
  }

  async getMangaDetails(id: string): Promise<Manga> {
    const cacheKey = `detail:${id}`;
    const cached = this.cache.get<Manga>(cacheKey);
    if (cached) return cached;

    return this.dedup.detail.get(cacheKey, async () => {
      // id = "{genre}/{slug}/{titleNo}"
      const parts = id.split("/");
      if (parts.length < 3) {
        return { id, title: "WEBTOON", coverUrl: "", sourceId: this.id };
      }
      const [genre, slug, titleNo] = parts;

      try {
        const html = await this.http.getHtml(`/en/${genre}/${slug}/list?title_no=${titleNo}`);

        const title  = this.html.extractMeta(html, "og:title")
          ?? this.html.decodeEntities(slug.replace(/-/g, " "));
        const cover  = this.html.extractMeta(html, "og:image") ?? "";
        const desc   = this.html.extractMeta(html, "og:description") ?? "";

        // Detect "COMPLETED" badge on the series page
        const isComplete = /class="[^"]*ico_state[^"]*"\s*>\s*COMPLETED/i.test(html)
          || /class="[^"]*badge_completed[^"]*"/i.test(html)
          || /complete/i.test(html.match(/class="[^"]*titleStat[^"]*"[^>]*>([\s\S]{0,50})/)?.[1] ?? "");

        const result: Manga = {
          id,
          title:       this.html.decodeEntities(title),
          coverUrl:    cover,
          sourceId:    this.id,
          status:      isComplete ? "completed" : "ongoing",
          description: this.html.decodeEntities(desc),
          genres:      [genre.charAt(0).toUpperCase() + genre.slice(1)],
        };

        this.cache.set(cacheKey, result, TTL.detail);
        this.log.log(`getMangaDetails("${id}") → "${result.title}"`);
        return result;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        this.log.warn(`getMangaDetails("${id}") failed: ${String(err)}`);
        return {
          id,
          title:    this.html.decodeEntities(slug.replace(/-/g, " ")),
          coverUrl: "",
          sourceId: this.id,
        };
      }
    });
  }

  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    const cacheKey = `chapters:${mangaId}`;
    const cached = this.cache.get<Chapter[]>(cacheKey);
    if (cached) return cached;

    return this.dedup.chapters.get(cacheKey, async () => {
      // mangaId = "{genre}/{slug}/{titleNo}"
      const parts = mangaId.split("/");
      if (parts.length < 3) return [];
      const [genre, slug, titleNo] = parts;

      const allChapters: Chapter[] = [];
      const seenNos = new Set<string>();

      try {
        for (let pageNo = 1; pageNo <= MAX_CHAPTER_PAGES; pageNo++) {
          if (signal?.aborted) break;
          const path = `/en/${genre}/${slug}/list?title_no=${titleNo}&page=${pageNo}`;
          const html = await this.http.getHtml(path, { signal });
          const episodes = this.parseEpisodeList(html);
          if (episodes.length === 0) break;

          let newCount = 0;
          for (const ep of episodes) {
            if (!seenNos.has(ep.number)) {
              seenNos.add(ep.number);
              allChapters.push(ep);
              newCount++;
            }
          }

          // Stop if all episodes on this page were already seen (prevents infinite loops)
          if (newCount === 0) break;
        }

        // Sort ascending (episode 1 first) for the reader
        allChapters.sort((a, b) => Number(a.number) - Number(b.number));

        this.cache.set(cacheKey, allChapters, TTL.chapters);
        this.log.log(`getChapters("${mangaId}") → ${allChapters.length}`);
        if (allChapters.length === 0) {
          this.log.warn(`getChapters("${mangaId}") → 0 (HTML changed or no episodes yet?)`);
        }
        return allChapters;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        this.log.warn(`getChapters("${mangaId}") failed: ${String(err)}`);
        return allChapters; // Return whatever partial list we have
      }
    });
  }

  /**
   * Fetch episode panel images from the WEBTOON viewer page.
   *
   * chapterId IS the full relative viewer URL stored from getChapters(),
   * e.g. "/en/romance/lore-olympus/episode-1/viewer?title_no=1320&episode_no=1".
   *
   * Images on webtoon-phinf.pstatic.net require Referer: https://www.webtoons.com/
   * to bypass hotlink protection. On web, ImageLoader.maybeProxyUrl() automatically
   * rewrites these through the "naver-cdn" server proxy which injects the header.
   */
  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    const cacheKey = `pages:${chapterId}`;
    const cached = this.cache.get<string[]>(cacheKey);
    if (cached) return cached;

    return this.dedup.pages.get(cacheKey, async () => {
      try {
        if (signal?.aborted) return [];

        // Validate: chapter ID must look like a WEBTOON viewer path
        if (!chapterId.includes("/viewer?")) {
          this.log.warn(`getChapterPages: unexpected chapterId="${chapterId}"`);
          return [];
        }

        const html = await this.http.getHtml(chapterId, { signal });

        if (this.html.isCloudflare(html)) {
          throw this.error(
            "WEBTOON chapter page blocked by Cloudflare — please verify the source.",
            "cloudflare",
            403,
          );
        }

        const images = this.parseViewerImages(html);
        this.log.log(`getChapterPages("${chapterId}") → ${images.length} images`);

        if (images.length === 0) {
          this.log.warn(
            `getChapterPages → 0 images. HTML length=${html.length}. ` +
            `Check that the viewer page is loading correctly (may require cookies or age verification).`,
          );
        } else {
          this.cache.set(cacheKey, images, TTL.pages);
        }

        return images;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw this.error(`Naver chapter pages failed: ${String(err)}`, "network");
      }
    });
  }
}

// Singleton adapter instance — matches the export pattern used by all other adapters.
export const naverSource = new NaverAdapter();
