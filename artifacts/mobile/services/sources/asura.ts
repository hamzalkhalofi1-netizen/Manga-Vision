import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";

// Asura has moved domains multiple times. Current domain as of 2025:
// asuracomic.net (redirects from asurascans.com handled server-side)
const SITE_URL = "https://asuracomic.net";

const FETCH_OPTS = {
  sourceId: "asura",
  siteUrl: SITE_URL,
  timeoutMs: 20000,
  headers: {
    Accept: "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
  },
};

async function asuraFetch(path: string, query = ""): Promise<string> {
  const res = await proxiedFetch("asura", path, query, FETCH_OPTS);
  return res.text();
}

// ── Protection detection ───────────────────────────────────────────────────

function isCloudflarePage(html: string): boolean {
  return /just a moment|checking your browser|cf-browser-verification|challenge-form|attention required/i.test(html);
}

/**
 * Detect whether the response is the Asura SPA shell (not a content page).
 *
 * Asura (asuracomic.net) is a client-side SPA. ALL URLs return the same
 * 594KB HTML shell with a generic h1 title. Individual manga detail and
 * chapter pages are rendered client-side only and cannot be scraped.
 *
 * Detection: check for the generic site title in the sr-only h1 element.
 */
function isSpaShell(html: string): boolean {
  return /<h1[^>]*class="[^"]*sr-only[^"]*"[^>]*>\s*Read Free Manga/i.test(html) ||
    /Read Manga, Manhwa &amp; Manhua Online - Asura Scans/i.test(html);
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

// ── Astro v5 prop unwrapper ────────────────────────────────────────────────
// Asura uses Astro (SSG). Manga data is embedded as HTML-entity-encoded
// JSON inside `<astro-island props="...">` attributes using the serialisation
// format `[0, value]` (literal) / `[1, [...]]` (array).

function unpackAstro(v: unknown): unknown {
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === "number" && v[0] <= 1) {
      const inner = v[1];
      if (v[0] === 1 && Array.isArray(inner)) return inner.map(unpackAstro);
      return unpackAstro(inner);
    }
    return v.map(unpackAstro);
  }
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, unpackAstro(val)])
    );
  }
  return v;
}

// ── Next.js __NEXT_DATA__ extraction ──────────────────────────────────────

function extractNextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Inline JSON extraction (window.__DATA__ or similar) ───────────────────

function extractInlineJson(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  // Match large JSON blobs in script tags
  const scriptRe = /<script[^>]*>([\s\S]{50,}?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1].trim();
    // Look for assignment patterns: window.__X__ = {...} or var x = {...}
    const assignRe = /(?:window\.\w+|var \w+|const \w+|let \w+)\s*=\s*(\{[\s\S]{20,}\})\s*;?\s*$/;
    const am = body.match(assignRe);
    if (am) {
      try {
        results.push(JSON.parse(am[1]));
      } catch {}
    }
    // Try parsing the whole script as JSON
    if (body.startsWith("{") && body.endsWith("}")) {
      try {
        results.push(JSON.parse(body));
      } catch {}
    }
  }
  return results;
}

// ── Manga list extraction ─────────────────────────────────────────────────

function extractMangasFromAstroHtml(html: string): Manga[] {
  const results: Manga[] = [];
  const seen = new Set<string>();

  // Strategy 1: Parse rendered series card links with cover image
  // asuracomic.net: <a href="/series/{slug}"> or <a href="/comics/{slug}">
  const cardRe =
    /<a[^>]+href="\/(series|comics)\/([\w-]+)"[^>]*>[\s\S]{0,600}?<img[^>]+src="([^"]+)"[^>]+alt="([^"]{2,150})"/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const [, , slug, cover, title] = m;
    if (!seen.has(slug)) {
      seen.add(slug);
      results.push({ id: slug, title: title.trim(), coverUrl: cover, sourceId: "asura" });
    }
  }
  if (results.length > 0) {
    console.log(`[asura] Strategy 1 (rendered HTML cards): ${results.length} items`);
    return results;
  }

  // Strategy 2: Astro v5 serialized island data
  const decoded = decodeEntities(html);
  const urlRe = /"public_url":\[0,"\/(?:series|comics)\/([\w-]+)"\]/g;
  let um: RegExpExecArray | null;
  while ((um = urlRe.exec(decoded)) !== null) {
    const [, slug] = um;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const ctxStart = Math.max(0, um.index - 1200);
    const ctxEnd = Math.min(decoded.length, um.index + 400);
    const ctx = decoded.slice(ctxStart, ctxEnd);
    const titleM = ctx.match(/"title":\[0,"([^"]{2,150})"\]/);
    const coverM = ctx.match(/"(?:cover_url|image)":\[0,"(https?:\/\/[^"]+)"\]/);
    const title = titleM?.[1] ?? slug.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " ");
    const coverUrl = coverM?.[1] ?? "";
    results.push({ id: slug, title, coverUrl, sourceId: "asura" });
  }
  if (results.length > 0) {
    console.log(`[asura] Strategy 2 (Astro island JSON): ${results.length} items`);
    return results;
  }

  // Strategy 3: Next.js __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData) {
    const pageProps = (nextData as Record<string, unknown>)?.props as Record<string, unknown> | undefined;
    const seriesArr = pageProps?.series ?? pageProps?.comics ?? pageProps?.mangas;
    if (Array.isArray(seriesArr)) {
      for (const item of seriesArr as Array<Record<string, unknown>>) {
        const slug = String(item.slug ?? item.id ?? "");
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        results.push({
          id: slug,
          title: String(item.title ?? item.name ?? slug),
          coverUrl: String(item.image ?? item.cover ?? item.thumbnail ?? ""),
          sourceId: "asura",
        });
      }
      if (results.length > 0) {
        console.log(`[asura] Strategy 3 (Next.js __NEXT_DATA__): ${results.length} items`);
        return results;
      }
    }
  }

  // Strategy 4: bare href fallback — /series/{slug} or /comics/{slug}
  const hrefRe = /href="\/(series|comics)\/([\w-]+)"/g;
  let hm: RegExpExecArray | null;
  while ((hm = hrefRe.exec(html)) !== null) {
    const slug = hm[2];
    if (!seen.has(slug)) {
      seen.add(slug);
      results.push({
        id: slug,
        title: slug.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " "),
        coverUrl: "",
        sourceId: "asura",
      });
    }
  }
  console.log(`[asura] Strategy 4 (href fallback): ${results.length} slugs`);
  return results;
}

// ── Chapter extraction ────────────────────────────────────────────────────

/**
 * Detect the URL base path for manga detail and chapter links.
 * Asura uses /comics/{slug} on older domains and /series/{slug} on newer.
 */
function detectBasePath(html: string): "series" | "comics" {
  const seriesCount = (html.match(/href="\/series\//g) ?? []).length;
  const comicsCount = (html.match(/href="\/comics\//g) ?? []).length;
  return seriesCount >= comicsCount ? "series" : "comics";
}

function extractChaptersFromAstroHtml(html: string): Chapter[] {
  const decoded = decodeEntities(html);
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  const basePath = detectBasePath(html);

  // Strategy 1: Astro island JSON — look for chapter objects
  // Field order can vary, so use separate regexes and merge by id
  const idRe = /"id"\s*:\s*"([\w-]+)"/g;
  const chunkSize = 400;
  let m: RegExpExecArray | null;

  // Collect {id, number, title} triples from Astro-encoded chapter data
  const chapterMap = new Map<string, { number: string; title?: string; date?: string }>();

  // Look for number/name/title near each id
  while ((m = idRe.exec(decoded)) !== null) {
    const id = m[1];
    // Skip non-chapter IDs (too short or too long)
    if (id.length < 2 || id.length > 60) continue;
    const ctx = decoded.slice(Math.max(0, m.index - 50), m.index + chunkSize);
    const numM = ctx.match(/"(?:number|chapter_number|chap)"\s*:\s*"?([\d.]+)"?/);
    if (!numM) continue;
    if (chapterMap.has(id)) continue;
    const titleM = ctx.match(/"(?:title|name)"\s*:\s*"([^"]{0,150})"/);
    const dateM = ctx.match(/"(?:date|created_at|updated_at|published_at)"\s*:\s*"([^"]{4,30})"/);
    chapterMap.set(id, {
      number: numM[1],
      title: titleM?.[1] || undefined,
      date: dateM?.[1] || "",
    });
  }

  for (const [id, data] of chapterMap) {
    if (!seen.has(id)) {
      seen.add(id);
      chapters.push({ id, number: data.number, title: data.title, publishedAt: data.date ?? "" });
    }
  }

  if (chapters.length > 0) {
    console.log(`[asura] extractChapters strategy1 (Astro JSON) → ${chapters.length} chapters`);
    // Sort descending by chapter number
    return chapters.sort((a, b) => parseFloat(b.number) - parseFloat(a.number));
  }

  // Strategy 2: Next.js __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData) {
    const findChapters = (obj: unknown, depth = 0): void => {
      if (depth > 6 || !obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        for (const item of obj) findChapters(item, depth + 1);
        return;
      }
      const o = obj as Record<string, unknown>;
      const num = o.number ?? o.chapter ?? o.chap;
      const id = o.id ?? o.slug ?? o.chapter_id;
      if (id && num && !seen.has(String(id))) {
        seen.add(String(id));
        chapters.push({
          id: String(id),
          number: String(num),
          title: o.title ? String(o.title) : undefined,
          publishedAt: String(o.date ?? o.created_at ?? o.updated_at ?? ""),
        });
        return;
      }
      for (const val of Object.values(o)) findChapters(val, depth + 1);
    };
    findChapters(nextData);
    if (chapters.length > 0) {
      console.log(`[asura] extractChapters strategy2 (Next.js) → ${chapters.length} chapters`);
      return chapters.sort((a, b) => parseFloat(b.number) - parseFloat(a.number));
    }
  }

  // Strategy 3: href chapter links
  // Patterns: /{basePath}/{slug}/chapter-{N} or /{basePath}/{slug}/{N}
  const hrefRe = new RegExp(
    `href="(\\/${basePath}\\/[\\w-]+\\/(?:chapter-)?([\\d.]+)[^"#?]*)"`,
    "g"
  );
  while ((m = hrefRe.exec(html)) !== null) {
    const [, path, num] = m;
    if (!seen.has(path)) {
      seen.add(path);
      // Try to extract a chapter title from nearby text
      const ctx = html.slice(m.index, m.index + 200);
      const titleM = ctx.match(/class="[^"]*title[^"]*"[^>]*>([^<]{2,100})</);
      chapters.push({ id: path, number: num, title: titleM?.[1]?.trim(), publishedAt: "" });
    }
  }

  console.log(`[asura] extractChapters strategy3 (href) → ${chapters.length} chapters`);
  return chapters.sort((a, b) => parseFloat(b.number) - parseFloat(a.number));
}

// ── Chapter page extraction ───────────────────────────────────────────────

function extractChapterPagesFromHtml(html: string): string[] {
  const decoded = decodeEntities(html);
  const urls = new Set<string>();

  // Strategy 1: JSON image arrays in Astro props / inline scripts
  const arrayRe = /"(?:images|pages|imageUrls?|chapter_images)"\s*:\s*\[([^\]]{20,})\]/g;
  let m: RegExpExecArray | null;
  while ((m = arrayRe.exec(decoded)) !== null) {
    const inner = m[1];
    const imgRe = /"(https?:\/\/[^"]{10,300}\.(?:jpg|jpeg|png|webp)(?:[^"]{0,50})?)"/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(inner)) !== null) urls.add(im[1]);
  }
  if (urls.size > 0) {
    console.log(`[asura] extractChapterPages strategy1 (JSON arrays) → ${urls.size} images`);
    return [...urls];
  }

  // Strategy 2: Next.js __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData) {
    const collectImages = (obj: unknown, depth = 0): void => {
      if (depth > 8 || !obj) return;
      if (typeof obj === "string") {
        if (/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/i.test(obj)) urls.add(obj);
        return;
      }
      if (Array.isArray(obj)) { obj.forEach((v) => collectImages(v, depth + 1)); return; }
      if (typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        // Prioritize arrays named "images", "pages", etc.
        for (const key of ["images", "pages", "chapter_images", "imageUrls"]) {
          if (Array.isArray(o[key])) { collectImages(o[key], depth + 1); }
        }
        for (const val of Object.values(o)) collectImages(val, depth + 1);
      }
    };
    collectImages(nextData);
    if (urls.size > 0) {
      console.log(`[asura] extractChapterPages strategy2 (Next.js) → ${urls.size} images`);
      return [...urls];
    }
  }

  // Strategy 3: img elements with src or data-src
  const imgRe = /<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1];
    if (!src.includes("logo") && !src.includes("icon") && !src.includes("avatar")) {
      urls.add(src);
    }
  }
  if (urls.size > 0) {
    console.log(`[asura] extractChapterPages strategy3 (img elements) → ${urls.size} images`);
    return [...urls];
  }

  // Strategy 4: CDN URL patterns in script blocks
  // Asura uses various CDN domains
  const cdnRe = /(https?:\/\/(?:cdn\.|gg\.|img\.|s3\.)?(?:asura[^"'\s]*?|[^"'\s]+)\/[^"'\s]{4,300}\.(?:jpg|jpeg|png|webp))/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    const url = m[1];
    if (!url.includes("logo") && !url.includes("favicon")) urls.add(url);
  }

  console.log(`[asura] extractChapterPages strategy4 (CDN URLs) → ${urls.size} images`);
  return [...urls];
}

// ── Source implementation ─────────────────────────────────────────────────

export const asuraSource: MangaSource = {
  id: "asura",
  name: "Asura Scans",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    try {
      const basePath = "/series"; // asuracomic.net uses /series
      const qs = new URLSearchParams({ name: query, page: String(page + 1) }).toString();
      const html = await asuraFetch(basePath, `?${qs}`);
      console.log(`[asura] search response size: ${html.length}`);
      if (isCloudflarePage(html)) {
        throw new SourceError("Asura Scans is protected by Cloudflare verification.", "cloudflare", 403, "asura");
      }
      const results = extractMangasFromAstroHtml(html).filter(
        (m) => !query || m.title.toLowerCase().includes(query.toLowerCase())
      );
      console.log(`[asura] search "${query}" → ${results.length} results`);
      if (results.length === 0) {
        console.warn("[asura] PARSER DIAGNOSTIC: search returned 0. HTML snippet[:300]:", html.slice(0, 300));
      }
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`Asura search failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, "asura");
    }
  },

  async getTrending(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ page: String(page + 1), order: "rating" }).toString();
      const html = await asuraFetch("/series", `?${qs}`);
      console.log(`[asura] getTrending response size: ${html.length}`);
      if (isCloudflarePage(html)) {
        throw new SourceError("Asura Scans blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      const results = extractMangasFromAstroHtml(html);
      console.log(`[asura] getTrending → ${results.length} results`);
      if (results.length === 0) {
        console.warn("[asura] PARSER DIAGNOSTIC: getTrending returned 0. Has /series/ links:", /\/series\//.test(html));
      }
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`Asura trending failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, "asura");
    }
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ page: String(page + 1), order: "update" }).toString();
      const html = await asuraFetch("/series", `?${qs}`);
      console.log(`[asura] getLatestUpdates response size: ${html.length}`);
      if (isCloudflarePage(html)) {
        throw new SourceError("Asura Scans blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      const results = extractMangasFromAstroHtml(html);
      console.log(`[asura] getLatestUpdates → ${results.length} results`);
      if (results.length === 0) {
        console.warn("[asura] PARSER DIAGNOSTIC: getLatestUpdates returned 0.");
      }
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`Asura latest failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, "asura");
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      // Try /comics/{id} first (primary), then /series/{id} (legacy).
      // NOTE: Asura is a SPA — all URLs return the same listing HTML shell.
      // We extract the manga's info from the listing page if it's present.
      let html = "";
      for (const base of ["/comics", "/series"]) {
        try {
          html = await asuraFetch(`${base}/${id}`);
          if (html.length > 500 && !isCloudflarePage(html)) break;
        } catch {
          // try next
        }
      }
      if (!html || html.length < 100) {
        return { id, title: id.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " "), coverUrl: "", sourceId: "asura" };
      }
      if (isCloudflarePage(html)) {
        throw new SourceError("Asura detail page blocked by Cloudflare.", "cloudflare", 403, "asura");
      }

      console.log(`[asura] getMangaDetails(${id}) response size: ${html.length}`);

      const decoded = decodeEntities(html);
      const titleM =
        decoded.match(/"title"\s*:\s*"([^"]{2,150})"/) ??
        html.match(/<h1[^>]*>([^<]{2,150})<\/h1>/);
      const coverM =
        decoded.match(/"(?:cover_url|image|thumbnail)"\s*:\s*"(https?:\/\/[^"]+)"/) ??
        html.match(/property="og:image"\s+content="([^"]+)"/);
      const descM =
        decoded.match(/"(?:description|synopsis|summary)"\s*:\s*"([^"]{2,500})"/) ??
        html.match(/<p[^>]*class="[^"]*(?:description|synopsis)[^"]*"[^>]*>([\s\S]{2,500}?)<\/p>/i);
      const authorM = decoded.match(/"(?:author|artist)"\s*:\s*"([^"]{2,100})"/);

      // Also run the manga list extractor on this page to pick up card data
      const cards = extractMangasFromAstroHtml(html);
      const found = cards.find((m) => m.id === id);

      return {
        id,
        title: found?.title ?? titleM?.[1]?.trim() ?? id.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " "),
        coverUrl: found?.coverUrl ?? coverM?.[1] ?? "",
        sourceId: "asura",
        description: descM?.[1]?.replace(/<[^>]*>/g, "").trim(),
        author: authorM?.[1],
      };
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return { id, title: id.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " "), coverUrl: "", sourceId: "asura" };
    }
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      // Try both /comics/{id} (primary) and /series/{id} (legacy) paths.
      // NOTE: Asura (asuracomic.net) is a client-side SPA. ALL URLs return
      // the same 594KB HTML shell. Chapter data is loaded client-side only.
      // We detect the SPA shell and throw a clear error instead of returning 0.
      let html = "";
      let usedBase = "/comics";
      for (const base of ["/comics", "/series"]) {
        try {
          html = await asuraFetch(`${base}/${mangaId}`);
          if (html.length > 500 && !isCloudflarePage(html)) {
            usedBase = base;
            break;
          }
        } catch {
          // try next
        }
      }

      if (!html || html.length < 100) {
        console.warn(`[asura] getChapters(${mangaId}) got empty response`);
        return [];
      }
      if (isCloudflarePage(html)) {
        throw new SourceError("Asura chapters blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      if (isSpaShell(html)) {
        // Asura uses client-side rendering — chapter data is not in the static HTML.
        // The user needs to open Asura in a browser (via the verification WebView) to
        // establish a session that lets the JS app load chapter data.
        console.warn(`[asura] getChapters(${mangaId}) got SPA shell (no SSR for manga detail pages)`);
        throw new SourceError(
          "Asura chapter list requires browser rendering. Tap 'Verify Source' in source settings to open Asura in a browser, then return to the app.",
          "auth", 200, "asura"
        );
      }

      console.log(`[asura] getChapters(${mangaId}) via ${usedBase}, HTML size: ${html.length}`);

      const chapters = extractChaptersFromAstroHtml(html);
      if (chapters.length === 0) {
        console.warn(`[asura] PARSER DIAGNOSTIC: getChapters(${mangaId}) → 0. HTML has chapter links:`, /chapter-\d+/.test(html));
      }
      return chapters;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    try {
      // chapterId can be a full path like "/comics/slug/chapter-1" or "/series/slug/chapter-1"
      const path = chapterId.startsWith("/")
        ? chapterId
        : chapterId.includes("/")
          ? `/${chapterId}`
          : `/comics/${chapterId}`;

      const html = await asuraFetch(path);
      console.log(`[asura] getChapterPages(${chapterId}) via ${path}, HTML size: ${html.length}`);

      if (isCloudflarePage(html)) {
        throw new SourceError("Asura chapter page blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      if (isSpaShell(html)) {
        throw new SourceError(
          "Asura chapter pages require browser rendering. Please verify the source first.",
          "auth", 200, "asura"
        );
      }

      const pages = extractChapterPagesFromHtml(html);
      if (pages.length === 0) {
        console.warn(`[asura] PARSER DIAGNOSTIC: getChapterPages(${chapterId}) → 0 images. HTML size: ${html.length}`);
      }
      return pages;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },
};
