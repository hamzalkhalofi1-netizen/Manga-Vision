import { Platform } from "react-native";
import { Chapter, Manga, MangaSource, MangaStatus } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";
import { webViewBridge } from "../webViewBridge";
import { InFlightDedup } from "../network/InFlightDedup";
import { SourceDiagnosticsLogger } from "./SourceDiagnosticsLogger";

const SITE_URL = "https://bato.to";
const SOURCE_ID = "bato";

const VALID_STATUSES = new Set<string>(["ongoing", "completed", "hiatus", "cancelled"]);
function toMangaStatus(s: string | undefined): MangaStatus | undefined {
  if (!s) return undefined;
  const lower = s.toLowerCase();
  return VALID_STATUSES.has(lower) ? (lower as MangaStatus) : undefined;
}

const FETCH_OPTS = {
  sourceId: SOURCE_ID,
  siteUrl: SITE_URL,
  timeoutMs: 20000,
  headers: {
    Accept: "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: SITE_URL + "/",
  },
};

// Bato.to is a Next.js SSR site with Cloudflare protection.
// On native: persistent WebView handles CF bypass + SSR rendering.
// On web: server proxy fetches SSR HTML; chapter images extracted from __NEXT_DATA__.
// Chapter images need Referer: https://bato.to/ to load from the CDN.
const RENDER_WAIT_MS = 5000;

const diag = new SourceDiagnosticsLogger(SOURCE_ID);

const dedup = {
  trending: new InFlightDedup<Manga[]>(),
  latest: new InFlightDedup<Manga[]>(),
  search: new InFlightDedup<Manga[]>(),
  detail: new InFlightDedup<Manga>(),
  chapters: new InFlightDedup<Chapter[]>(),
  pages: new InFlightDedup<string[]>(),
};

// ── Core fetch ────────────────────────────────────────────────────────────

async function batoFetch(path: string, query = ""): Promise<string> {
  const url = `${SITE_URL}${path}${query}`;

  if (Platform.OS !== "web") {
    const resp = await webViewBridge.fetchRendered(SOURCE_ID, url, RENDER_WAIT_MS);
    if (!resp.ok && (resp.status === 403 || resp.status === 503)) {
      throw new SourceError(
        "Bato.to requires browser verification.",
        "cloudflare",
        resp.status,
        SOURCE_ID,
      );
    }
    return resp.body;
  }

  const res = await proxiedFetch(SOURCE_ID, path, query, FETCH_OPTS);
  return res.text();
}

// ── Protection detection ───────────────────────────────────────────────────

function isCloudflarePage(html: string): boolean {
  return /just a moment|checking your browser|cf-browser-verification|challenge-form|attention required/i.test(html);
}

// ── __NEXT_DATA__ extraction ───────────────────────────────────────────────

function extractNextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deepGet(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// ── HTML entity decode ─────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ── Manga list parsing ─────────────────────────────────────────────────────

/**
 * Parse manga cards from bato.to listing HTML.
 *
 * Bato.to (2025) uses Next.js SSR. Listing pages embed cards as:
 *   <a href="/title/{numeric_id}-{slug}">
 *     <img src="{cover}" alt="{title}">
 *     ...
 *   </a>
 *
 * Strategies:
 *   1. Rendered HTML anchor+img pattern (after WebView JS hydration)
 *   2. __NEXT_DATA__ JSON: props.pageProps.data array
 *   3. Bare href fallback for /title/{id} links
 */
function parseMangaList(html: string): Manga[] {
  const results: Manga[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  diag.log(`parseMangaList size=${html.length} CF=${isCloudflarePage(html)}`);

  // Strategy 1: rendered anchor → img pattern (works after WebView hydration)
  // Bato card: <a href="/title/12345-one-piece"> … <img src/data-src="…" alt="One Piece"> …
  // Matches both src and data-src attributes in either order relative to alt.
  const cardRe =
    /<a[^>]+href="\/title\/([\d]+(?:-[\w-]+)?)"[^>]*>[\s\S]{0,800}?<img[^>]+(?:(?:data-src|src)="([^"]+)"[^>]+alt|alt="([^"]{1,150})"[^>]+(?:data-src|src)="([^"]+)")[^>]*>/g;
  while ((m = cardRe.exec(html)) !== null) {
    const [, id, srcFirst, altSecond, srcSecond] = m;
    if (!id || seen.has(id)) continue;
    // m[2] & m[3]: src-then-alt order; m[3] & m[4]: alt-then-src order
    const cover = srcFirst ?? srcSecond ?? "";
    const title = (altSecond ?? "").trim();
    if (!title) continue;
    seen.add(id);
    results.push({ id, title, coverUrl: cover, sourceId: SOURCE_ID });
  }
  if (results.length > 0) {
    diag.log(`parseMangaList s1 (card HTML src/data-src) → ${results.length}`);
    return results;
  }

  // Strategy 1b: simpler fallback — anchor href + nearby img (any attribute order)
  const re1b =
    /<a[^>]+href="\/title\/([\d]+(?:-[\w-]+)?)"[^>]*>[\s\S]{0,600}?<img[^>]+(?:data-src|src)="([^"]+)"[^>]*(?:alt="([^"]{1,150})")?/g;
  while ((m = re1b.exec(html)) !== null) {
    const [, id, cover, title] = m;
    if (id && !seen.has(id)) {
      seen.add(id);
      results.push({
        id,
        title: (title ?? id.replace(/^\d+-/, "").replace(/-/g, " ")).trim(),
        coverUrl: cover,
        sourceId: SOURCE_ID,
      });
    }
  }
  if (results.length > 0) {
    diag.log(`parseMangaList s1b (anchor+img fallback) → ${results.length}`);
    return results;
  }

  // Strategy 2: __NEXT_DATA__ JSON
  const nextData = extractNextData(html);
  if (nextData) {
    const pageData = deepGet(nextData, "props", "pageProps", "data");
    // data may be an array of manga items directly
    const arr = Array.isArray(pageData) ? pageData : null;
    if (arr && arr.length > 0) {
      for (const item of arr as Array<Record<string, unknown>>) {
        const rawId = String(item.id ?? item.urlPath ?? "");
        const id = rawId.replace(/^\/title\//, "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const title = String(item.name ?? item.title ?? id);
        const coverUrl = String(item.cover ?? item.coverUrl ?? "");
        results.push({ id, title, coverUrl, sourceId: SOURCE_ID });
      }
      if (results.length > 0) {
        diag.log(`parseMangaList s2 (__NEXT_DATA__ array) → ${results.length}`);
        return results;
      }
    }

    // data.items or data.comics sub-key
    const items = deepGet(nextData, "props", "pageProps", "data", "items") ??
                  deepGet(nextData, "props", "pageProps", "data", "comics");
    if (Array.isArray(items)) {
      for (const item of items as Array<Record<string, unknown>>) {
        const rawId = String(item.id ?? item.urlPath ?? "");
        const id = rawId.replace(/^\/title\//, "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push({
          id,
          title: String(item.name ?? item.title ?? id),
          coverUrl: String(item.cover ?? item.coverUrl ?? ""),
          sourceId: SOURCE_ID,
        });
      }
      if (results.length > 0) {
        diag.log(`parseMangaList s2b (__NEXT_DATA__ items) → ${results.length}`);
        return results;
      }
    }
  }

  // Strategy 3: bare /title/{id} href fallback (cover and title unknown)
  const hrefRe = /href="\/title\/((\d+)(?:-[\w-]+)?)"/g;
  while ((m = hrefRe.exec(html)) !== null) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      // Try to find nearby title text (h3/div with class containing "title" or "name")
      const ctx = html.slice(Math.max(0, m.index - 100), m.index + 400);
      const titleM = ctx.match(/<(?:h3|h4|div|span)[^>]*>[^<]{2,100}<\/(?:h3|h4|div|span)>/);
      const title = titleM
        ? titleM[0].replace(/<[^>]+>/g, "").trim()
        : id.replace(/^\d+-/, "").replace(/-/g, " ");
      results.push({ id, title, coverUrl: "", sourceId: SOURCE_ID });
    }
  }
  diag.log(`parseMangaList s3 (href fallback) → ${results.length}`);
  return results;
}

// ── Manga detail parsing ───────────────────────────────────────────────────

interface BatoMangaDetail {
  title: string;
  description: string;
  coverUrl: string;
  status?: string;
  author?: string;
  genres?: string[];
}

function parseMangaDetail(html: string, id: string): BatoMangaDetail {
  // Primary: __NEXT_DATA__ has complete manga info
  const nextData = extractNextData(html);
  if (nextData) {
    const data = deepGet(nextData, "props", "pageProps", "data") as Record<string, unknown> | undefined;
    if (data && typeof data === "object") {
      const title = String(data.name ?? data.title ?? "");
      const description = String(data.summary ?? data.description ?? data.desc ?? "");
      const coverUrl = String(data.cover ?? data.coverUrl ?? data.image ?? "");
      const status = String(data.status ?? data.origStatus ?? "");

      const authorsRaw = data.authors ?? data.author ?? [];
      const authorList = Array.isArray(authorsRaw)
        ? (authorsRaw as Array<Record<string, unknown>>).map((a) =>
            typeof a === "string" ? a : String(a.name ?? a)
          )
        : [String(authorsRaw)];
      const author = authorList.filter(Boolean).join(", ") || undefined;

      const genresRaw = data.genres ?? data.genre ?? data.cats ?? [];
      const genres = Array.isArray(genresRaw)
        ? (genresRaw as Array<Record<string, unknown>>).map((g) =>
            typeof g === "string" ? g : String(g.name ?? g)
          )
        : [];

      if (title) {
        diag.log(`parseMangaDetail(${id}) __NEXT_DATA__ → "${title}" author="${author ?? ""}"`);
        return { title, description, coverUrl, status, author, genres };
      }
    }
  }

  // Fallback: parse rendered HTML
  const decoded = decodeEntities(html);

  // Title: <h3 class="item-title"> or <title> tag
  const titleM =
    decoded.match(/<h3[^>]*class="[^"]*(?:item-title|title)[^"]*"[^>]*>([^<]{1,200})<\/h3>/) ??
    decoded.match(/<title>([^<|]{1,150})(?:\s*[|–-].*)?<\/title>/);
  const title = titleM ? titleM[1].trim() : id.replace(/^\d+-/, "").replace(/-/g, " ");

  // Description
  const descM = decoded.match(/<div[^>]*class="[^"]*(?:limit-html|summary|description|synopsis)[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/);
  const description = descM ? descM[1].replace(/<[^>]+>/g, "").trim() : "";

  // Cover
  const coverM = decoded.match(/<img[^>]+class="[^"]*(?:item-cover|cover|poster)[^"]*"[^>]+src="([^"]+)"/);
  const coverUrl = coverM ? coverM[1] : "";

  diag.log(`parseMangaDetail(${id}) HTML fallback → "${title}"`);
  return { title, description, coverUrl };
}

// ── Chapter list parsing ───────────────────────────────────────────────────

/**
 * Parse chapters from bato.to manga detail HTML.
 *
 * Bato.to embeds the chapter list in __NEXT_DATA__ under:
 *   props.pageProps.data.chaps  — array of chapter objects
 *
 * Each chapter object:
 *   { id: number, title: string, dueAt: string|null, addedAt: number, ... }
 *
 * The chapter URL path is /chapter/{id}.
 * Chapter number can be extracted from the title (e.g. "Ch. 42") or an
 * explicit field like `chap` or `idx`.
 */
function parseChapters(html: string, mangaId: string): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  // Strategy 1: __NEXT_DATA__ chaps array
  const nextData = extractNextData(html);
  if (nextData) {
    const data = deepGet(nextData, "props", "pageProps", "data") as Record<string, unknown> | undefined;
    const chapsRaw = data?.chaps ?? data?.chapters ?? data?.chapterList;
    if (Array.isArray(chapsRaw) && chapsRaw.length > 0) {
      for (const c of chapsRaw as Array<Record<string, unknown>>) {
        const chId = String(c.id ?? "");
        if (!chId || seen.has(chId)) continue;
        seen.add(chId);

        // Derive chapter number from chap field, then from title
        let num = String(c.chap ?? c.idx ?? c.number ?? "");
        if (!num) {
          const titleStr = String(c.title ?? c.name ?? "");
          const numM = titleStr.match(/(?:Ch(?:apter)?\.?\s*)([\d.]+)/i);
          num = numM ? numM[1] : "";
        }
        if (!num) num = String(chId);

        const rawTitle = String(c.title ?? c.name ?? "");
        const cleanTitle = rawTitle.replace(/^Ch(?:apter)?\.?\s*[\d.]+[:\s-]*/i, "").trim();

        let publishedAt = "";
        if (c.addedAt) {
          try {
            publishedAt = new Date(Number(c.addedAt) * 1000).toISOString().slice(0, 10);
          } catch {}
        } else if (c.dueAt) {
          publishedAt = String(c.dueAt);
        }

        chapters.push({
          id: `/chapter/${chId}`,
          number: num || chId,
          title: cleanTitle || undefined,
          publishedAt,
        });
      }

      if (chapters.length > 0) {
        diag.log(`parseChapters(${mangaId}) __NEXT_DATA__ → ${chapters.length}`);
        // Sort descending by chapter number
        return chapters.sort((a, b) => parseFloat(b.number) - parseFloat(a.number));
      }
    }
  }

  // Strategy 2: rendered HTML — anchor links matching /chapter/{id}
  // <a href="/chapter/67890">Chapter 42</a>
  const chRe = /href="(\/chapter\/([\d]+))"[^>]*>(?:[^<]{0,80}Ch(?:apter)?\.?\s*([\d.]+)[^<]{0,80})<\/a>/gi;
  while ((m = chRe.exec(html)) !== null) {
    const [, href, , num] = m;
    if (seen.has(href)) continue;
    seen.add(href);
    const ctx = html.slice(m.index, m.index + 300);
    const dateM = ctx.match(/(\d{4}-\d{2}-\d{2}|\w+ \d{1,2},?\s*\d{4})/);
    chapters.push({ id: href, number: num, publishedAt: dateM?.[1] ?? "" });
  }
  if (chapters.length > 0) {
    diag.log(`parseChapters(${mangaId}) s2 (rendered) → ${chapters.length}`);
    return chapters.sort((a, b) => parseFloat(b.number) - parseFloat(a.number));
  }

  // Strategy 3: bare /chapter/{id} href — number unknown, derive from order
  const bareRe = /href="(\/chapter\/([\d]+))"/g;
  while ((m = bareRe.exec(html)) !== null) {
    const [, href, chId] = m;
    if (seen.has(href)) continue;
    seen.add(href);
    chapters.push({ id: href, number: chId, publishedAt: "" });
  }
  diag.log(`parseChapters(${mangaId}) s3 (bare hrefs) → ${chapters.length}`);
  return chapters;
}

// ── Chapter image parsing ──────────────────────────────────────────────────

/**
 * Extract chapter image URLs from bato.to chapter HTML.
 *
 * Bato.to embeds images in:
 *   1. window.reader_init_data = { imgHttps: [...], ... } — inline script
 *   2. __NEXT_DATA__ → props.pageProps.data.imgHttps
 *   3. <img class="page-img" src="..."> elements
 *   4. Any bato CDN URL in script blocks
 *
 * All image URLs need Referer: https://bato.to/ to load correctly.
 */
function parseChapterImages(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  const addUrl = (u: string) => {
    const clean = u.trim();
    if (clean.startsWith("http") && !seen.has(clean)) {
      seen.add(clean);
      urls.push(clean);
    }
  };

  // Strategy 1: window.reader_init_data or bato.js embedded data
  // Various forms:
  //   window.reader_init_data = {"imgHttps":["url",...]}
  //   const readerConfig = {"imgHttps":["url",...]}
  //   batojs.bato_word = {"imgHttpLs":["url",...]}
  const imgHttpsRe = /"(?:imgHttps|imgHttpLs|images|pages?)"\s*:\s*\[([^\]]{10,})\]/g;
  while ((m = imgHttpsRe.exec(html)) !== null) {
    const inner = m[1];
    const urlRe = /"(https?:\/\/[^"]{10,400})"/g;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(inner)) !== null) addUrl(um[1]);
  }
  if (urls.length > 0) {
    diag.log(`parseChapterImages s1 (imgHttps script) → ${urls.length}`);
    return urls;
  }

  // Strategy 2: __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData) {
    const data = deepGet(nextData, "props", "pageProps", "data") as Record<string, unknown> | undefined;
    const imgArray =
      data?.imgHttps ??
      data?.imgHttpLs ??
      data?.images ??
      data?.pages;

    if (Array.isArray(imgArray)) {
      for (const u of imgArray as unknown[]) {
        if (typeof u === "string") addUrl(u);
      }
    }

    if (urls.length > 0) {
      diag.log(`parseChapterImages s2 (__NEXT_DATA__) → ${urls.length}`);
      return urls;
    }

    // Recursively collect any image-like strings from the data
    const collectImages = (obj: unknown, depth = 0): void => {
      if (depth > 8 || !obj) return;
      if (typeof obj === "string") {
        if (/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i.test(obj)) addUrl(obj);
        return;
      }
      if (Array.isArray(obj)) { obj.forEach((v) => collectImages(v, depth + 1)); return; }
      if (typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        for (const key of ["imgHttps", "imgHttpLs", "images", "pages", "chapter_images"]) {
          if (Array.isArray(o[key])) collectImages(o[key], depth + 1);
        }
        for (const val of Object.values(o)) collectImages(val, depth + 1);
      }
    };
    collectImages(nextData);
    if (urls.length > 0) {
      diag.log(`parseChapterImages s2b (recursive __NEXT_DATA__) → ${urls.length}`);
      return urls;
    }
  }

  // Strategy 3: <img class="page-img"> elements
  const imgTagRe = /<img[^>]+class="[^"]*page-img[^"]*"[^>]+src="(https?:\/\/[^"]+)"/gi;
  while ((m = imgTagRe.exec(html)) !== null) addUrl(m[1]);
  if (urls.length > 0) {
    diag.log(`parseChapterImages s3 (page-img elements) → ${urls.length}`);
    return urls;
  }

  // Strategy 4: any img with data-src or src pointing to a CDN host
  const cdnRe = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    const u = m[1];
    if (!u.includes("logo") && !u.includes("icon") && !u.includes("avatar") && !u.includes("cover")) {
      addUrl(u);
    }
  }
  if (urls.length > 0) {
    diag.log(`parseChapterImages s4 (img src/data-src) → ${urls.length}`);
    return urls;
  }

  // Strategy 5: bare CDN URL scan in all script content
  const batoCdnRe = /(https?:\/\/(?:[\w-]+\.)?bato\.to\/[^"'\s]{10,300}\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s]{0,100})?)/gi;
  while ((m = batoCdnRe.exec(html)) !== null) addUrl(m[1]);

  diag.log(`parseChapterImages s5 (CDN scan) → ${urls.length}`);
  return urls;
}

// ── Source implementation ─────────────────────────────────────────────────

export const batoSource: MangaSource = {
  id: SOURCE_ID,
  name: "Bato.to",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: true,

  async getTrending(page = 0): Promise<Manga[]> {
    return dedup.trending.get(`trending:${page}`, async () => {
      try {
        const qs = `?sort=views&lang=en&page=${page + 1}`;
        const html = await batoFetch("/browse", qs);
        if (isCloudflarePage(html)) {
          throw new SourceError("Bato.to is protected by Cloudflare verification.", "cloudflare", 403, SOURCE_ID);
        }
        const results = parseMangaList(html);
        if (results.length === 0) {
          diag.log(`WARN: getTrending p${page} → 0 results. HTML[:300]="${html.slice(0, 300)}"`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(`Bato.to trending failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, SOURCE_ID);
      }
    });
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    return dedup.latest.get(`latest:${page}`, async () => {
      try {
        const qs = `?sort=update&lang=en&page=${page + 1}`;
        const html = await batoFetch("/browse", qs);
        if (isCloudflarePage(html)) {
          throw new SourceError("Bato.to is protected by Cloudflare verification.", "cloudflare", 403, SOURCE_ID);
        }
        const results = parseMangaList(html);
        if (results.length === 0) {
          diag.log(`WARN: getLatestUpdates p${page} → 0 results. HTML[:300]="${html.slice(0, 300)}"`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(`Bato.to latest failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, SOURCE_ID);
      }
    });
  },

  async search(query: string, page = 0): Promise<Manga[]> {
    const key = `search:${query}:${page}`;
    return dedup.search.get(key, async () => {
      try {
        const qs = `?word=${encodeURIComponent(query)}&lang=en&page=${page + 1}`;
        const html = await batoFetch("/search", qs);
        if (isCloudflarePage(html)) {
          throw new SourceError("Bato.to is protected by Cloudflare verification.", "cloudflare", 403, SOURCE_ID);
        }
        const results = parseMangaList(html);
        diag.log(`search "${query}" p${page} → ${results.length} results`);
        if (results.length === 0) {
          diag.log(`WARN: search "${query}" → 0. HTML[:300]="${html.slice(0, 300)}"`);
        }
        return results;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(`Bato.to search failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, SOURCE_ID);
      }
    });
  },

  async getMangaDetails(id: string): Promise<Manga> {
    return dedup.detail.get(`detail:${id}`, async () => {
      try {
        const html = await batoFetch(`/title/${id}`);
        if (isCloudflarePage(html)) {
          throw new SourceError("Bato.to is protected by Cloudflare verification.", "cloudflare", 403, SOURCE_ID);
        }
        const detail = parseMangaDetail(html, id);
        return {
          id,
          title: detail.title || id.replace(/^\d+-/, "").replace(/-/g, " "),
          coverUrl: detail.coverUrl,
          description: detail.description,
          status: toMangaStatus(detail.status),
          author: detail.author,
          genres: detail.genres,
          sourceId: SOURCE_ID,
        };
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(`Bato.to getMangaDetails failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, SOURCE_ID);
      }
    });
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    return dedup.chapters.get(`chapters:${mangaId}`, async () => {
      try {
        const html = await batoFetch(`/title/${mangaId}`);
        if (isCloudflarePage(html)) {
          throw new SourceError("Bato.to is protected by Cloudflare verification.", "cloudflare", 403, SOURCE_ID);
        }
        const chapters = parseChapters(html, mangaId);
        diag.log(`getChapters(${mangaId}) → ${chapters.length} chapters`);
        if (chapters.length === 0) {
          diag.log(`WARN: getChapters(${mangaId}) → 0. HTML size=${html.length}`);
        }
        return chapters;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(`Bato.to getChapters failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, SOURCE_ID);
      }
    });
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    return dedup.pages.get(`pages:${chapterId}`, async () => {
      try {
        // chapterId is the path: "/chapter/67890"
        const html = await batoFetch(chapterId);
        if (isCloudflarePage(html)) {
          throw new SourceError("Bato.to is protected by Cloudflare verification.", "cloudflare", 403, SOURCE_ID);
        }
        const images = parseChapterImages(html);
        diag.log(`getChapterPages(${chapterId}) → ${images.length} images`);
        if (images.length === 0) {
          diag.log(`WARN: getChapterPages(${chapterId}) → 0. HTML size=${html.length} snippet="${html.slice(0, 300)}"`);
        }
        return images;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError(`Bato.to getChapterPages failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, SOURCE_ID);
      }
    });
  },
};
