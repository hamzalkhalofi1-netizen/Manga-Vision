import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";

const SITE_URL = "https://asurascans.com";

const FETCH_OPTS = {
  sourceId: "asura",
  siteUrl: SITE_URL,
  timeoutMs: 15000,
  headers: { Accept: "text/html,application/xhtml+xml,*/*" },
};

async function asuraFetch(path: string, query = ""): Promise<string> {
  const res = await proxiedFetch("asura", path, query, FETCH_OPTS);
  return res.text();
}

// ── Astro v5 HTML parsing ──────────────────────────────────────────────────
// Asura uses Astro v5 (SSG). Manga data is embedded as HTML-entity-encoded
// JSON inside `<astro-island props="...">` attributes using the serialisation
// format `[0, value]` (literal) / `[1, [...]]` (array).

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

// Unwrap Astro [type, value] tuples recursively.
function unpackAstro(v: unknown): unknown {
  if (Array.isArray(v)) {
    // [0, literal] or [1, [...array items]]
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

function extractMangasFromAstroHtml(html: string): Manga[] {
  const results: Manga[] = [];
  const seen = new Set<string>();

  // Strategy 1: Parse rendered HTML series cards (most reliable).
  // Card structure: <a href="/comics/{slug}" ...><img src="{cover}" alt="{title}"
  // The page renders full card HTML for each series including cover + alt title.
  const cardRe =
    /<a[^>]+href="(\/comics\/([\w-]+))"[^>]*>[\s\S]{0,600}?<img[^>]+src="([^"]+)"[^>]+alt="([^"]{2,150})"/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const [, , slug, cover, title] = m;
    if (!seen.has(slug)) {
      seen.add(slug);
      results.push({ id: slug, title: title.trim(), coverUrl: cover, sourceId: "asura" });
    }
  }
  if (results.length > 0) {
    console.log(`[asura] Strategy 1 (rendered HTML): ${results.length} cards`);
    return results;
  }

  // Strategy 2: Astro v5 serialized data.
  // Asura encodes props as HTML entities in `<astro-island props="...">` with
  // `[0, value]` tuples. After entity-decoding, pattern is:
  // "public_url":[0,"/comics/slug"]
  const decoded = decodeEntities(html);
  const urlRe = /"public_url":\[0,"(\/comics\/([\w-]+))"\]/g;
  let um: RegExpExecArray | null;
  while ((um = urlRe.exec(decoded)) !== null) {
    const [, , slug] = um;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const ctxStart = Math.max(0, um.index - 1200);
    const ctxEnd = Math.min(decoded.length, um.index + 300);
    const ctx = decoded.slice(ctxStart, ctxEnd);
    const titleM = ctx.match(/"title":\[0,"([^"]{2,150})"\]/);
    const coverM = ctx.match(/"cover_url":\[0,"(https?:\/\/[^"]+)"\]/);
    const title = titleM?.[1] ?? slug.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " ");
    const coverUrl = coverM?.[1] ?? "";
    console.log(`[asura] Strategy 2 (Astro JSON): slug=${slug} cover=${coverUrl ? "✓" : "✗"}`);
    results.push({ id: slug, title, coverUrl, sourceId: "asura" });
  }
  if (results.length > 0) return results;

  // Strategy 3: bare href fallback — get slugs with no metadata.
  const hrefRe = /href="\/comics\/([\w-]+)"/g;
  let hm: RegExpExecArray | null;
  while ((hm = hrefRe.exec(html)) !== null) {
    const slug = hm[1];
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
  console.log(`[asura] Strategy 3 (href fallback): ${results.length} slugs`);
  return results;
}

function collectMangas(
  obj: unknown,
  results: Manga[],
  seen: Set<string>,
  depth = 0
): void {
  if (depth > 8 || !obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectMangas(item, results, seen, depth + 1);
    return;
  }
  const o = obj as Record<string, unknown>;
  const pubUrl = typeof o.public_url === "string" ? o.public_url : null;
  if (pubUrl && pubUrl.startsWith("/comics/")) {
    const slug = pubUrl.replace("/comics/", "");
    if (!seen.has(slug)) {
      seen.add(slug);
      const title = typeof o.title === "string" ? o.title : slug.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " ");
      const coverUrl = typeof o.cover_url === "string" ? o.cover_url : "";
      console.log(`[asura] island card: slug=${slug} title=${title} cover=${coverUrl ? "✓" : "✗"}`);
      results.push({ id: slug, title, coverUrl, sourceId: "asura" });
    }
    return;
  }
  for (const val of Object.values(o)) collectMangas(val, results, seen, depth + 1);
}

// ── Chapter parsing from Astro HTML ──────────────────────────────────────────

function extractChaptersFromAstroHtml(html: string): Chapter[] {
  const decoded = decodeEntities(html);
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  // Look for chapter objects with "number" and chapter ID patterns
  // Asura encodes chapters in Astro props: {"id":"...","number":"1","title":"..."}
  const chRe = /"id":"([\w-]+)"[^}]{0,200}?"number":"([\d.]+)"[^}]{0,200}?"(?:title|name)":"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = chRe.exec(decoded)) !== null) {
    const [, id, number, title] = m;
    if (!seen.has(id)) {
      seen.add(id);
      chapters.push({ id, number, title: title || undefined, publishedAt: "" });
    }
  }
  if (chapters.length > 0) {
    console.log(`[asura] extracted ${chapters.length} chapters from Astro HTML`);
    return chapters;
  }

  // Fallback: look for chapter href links on the detail page
  // Pattern: /comics/slug/chapter-N or /comics/slug/N
  const hrefRe = /href="(\/comics\/[\w-]+\/(?:chapter-)?[\d.]+(?:[-/][^"]*)?)"[^>]*>[\s\S]{0,80}?(?:Chapter\s*)?([\d.]+)/g;
  while ((m = hrefRe.exec(html)) !== null) {
    const [, path, num] = m;
    const slug = path;
    if (!seen.has(slug)) {
      seen.add(slug);
      chapters.push({ id: slug, number: num, publishedAt: "" });
    }
  }

  console.log(`[asura] extracted ${chapters.length} chapters via href fallback`);
  return chapters;
}

function extractChapterPagesFromAstroHtml(html: string): string[] {
  const decoded = decodeEntities(html);

  // Look for page image arrays in Astro props
  const imageArrayRe = /"(?:images|pages|imageUrls?)"\s*:\s*\[([^\]]{20,})\]/g;
  let m: RegExpExecArray | null;
  while ((m = imageArrayRe.exec(decoded)) !== null) {
    const urls = [...m[1].matchAll(/"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi)]
      .map((u) => u[1]);
    if (urls.length > 0) {
      console.log(`[asura] extracted ${urls.length} chapter page images from Astro`);
      return urls;
    }
  }

  // Fallback: CDN image URLs
  const cdnRe = /(https?:\/\/cdn\.asurascans\.com\/[^"'\s]{4,200}\.(?:jpg|jpeg|png|webp))/gi;
  const urls = new Set<string>();
  while ((m = cdnRe.exec(html)) !== null) urls.add(m[1]);
  const result = [...urls];
  console.log(`[asura] CDN fallback: ${result.length} images`);
  return result;
}

// ── Source implementation ─────────────────────────────────────────────────

export const asuraSource: MangaSource = {
  id: "asura",
  name: "Asura Scans",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: false,

  async search(query: string, page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({
        name: query,
        page: String(page + 1),
      }).toString();
      const html = await asuraFetch("/browse", `?${qs}`);
      console.log(`[asura] search response size: ${html.length}`);
      if (/just a moment|checking your browser/i.test(html)) {
        throw new SourceError("Asura Scans is protected by Cloudflare verification.", "cloudflare", 403, "asura");
      }
      const results = extractMangasFromAstroHtml(html).filter(
        (m) => !query || m.title.toLowerCase().includes(query.toLowerCase())
      );
      console.log(`[asura] search "${query}" → ${results.length} results`);
      if (results.length === 0) {
        console.warn("[asura] PARSER DIAGNOSTIC: search returned 0 results. HTML snippet:", html.slice(0, 300));
      }
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`Asura search failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, "asura");
    }
  },

  async getTrending(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({
        page: String(page + 1),
        order: "rating",
      }).toString();
      const html = await asuraFetch("/browse", `?${qs}`);
      console.log(`[asura] getTrending response size: ${html.length}`);
      if (/just a moment|checking your browser/i.test(html)) {
        throw new SourceError("Asura Scans blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      const results = extractMangasFromAstroHtml(html);
      console.log(`[asura] getTrending → ${results.length} results`);
      if (results.length === 0) {
        console.warn("[asura] PARSER DIAGNOSTIC: getTrending returned 0. HTML contains /comics/ links:", /\/comics\//.test(html));
      }
      return results;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(`Asura trending failed: ${err instanceof Error ? err.message : "unknown"}`, "network", undefined, "asura");
    }
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({
        page: String(page + 1),
        order: "update",
      }).toString();
      const html = await asuraFetch("/browse", `?${qs}`);
      console.log(`[asura] getLatestUpdates response size: ${html.length}`);
      if (/just a moment|checking your browser/i.test(html)) {
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
      const html = await asuraFetch(`/comics/${id}`);
      console.log(`[asura] getMangaDetails(${id}) response size: ${html.length}`);
      if (/just a moment|checking your browser/i.test(html)) {
        throw new SourceError("Asura detail page blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      const decoded = decodeEntities(html);

      const titleM = decoded.match(/"title":"([^"]{2,150})"/) ?? html.match(/<h1[^>]*>([^<]{2,150})<\/h1>/);
      const coverM = decoded.match(/"cover_url":"(https?:\/\/[^"]+)"/) ?? html.match(/property="og:image"\s+content="([^"]+)"/);
      const descM = decoded.match(/"description":"([^"]{2,500})"/);
      const authorM = decoded.match(/"author":"([^"]{2,100})"/);

      const mangas = extractMangasFromAstroHtml(html);
      const found = mangas.find((m) => m.id === id);

      return {
        id,
        title: found?.title ?? titleM?.[1]?.trim() ?? id.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " "),
        coverUrl: found?.coverUrl ?? coverM?.[1] ?? "",
        sourceId: "asura",
        description: descM?.[1],
        author: authorM?.[1],
      };
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return { id, title: id.replace(/-[0-9a-f]{6,8}$/, "").replace(/-/g, " "), coverUrl: "", sourceId: "asura" };
    }
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      const html = await asuraFetch(`/comics/${mangaId}`);
      console.log(`[asura] getChapters(${mangaId}) response size: ${html.length}`);
      if (/just a moment|checking your browser/i.test(html)) {
        throw new SourceError("Asura chapters blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      const chapters = extractChaptersFromAstroHtml(html);
      if (chapters.length === 0) {
        console.warn(`[asura] PARSER DIAGNOSTIC: getChapters(${mangaId}) returned 0. Has /comics/ links:`, /\/comics\//.test(html));
      }
      return chapters;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    try {
      // chapterId is a path like "slug/chapter-1" or a full "/comics/slug/chapter-1"
      const path = chapterId.startsWith("/") ? chapterId : `/comics/${chapterId}`;
      const html = await asuraFetch(path);
      console.log(`[asura] getChapterPages(${chapterId}) response size: ${html.length}`);
      if (/just a moment|checking your browser/i.test(html)) {
        throw new SourceError("Asura chapter page blocked by Cloudflare.", "cloudflare", 403, "asura");
      }
      const pages = extractChapterPagesFromAstroHtml(html);
      if (pages.length === 0) {
        console.warn(`[asura] PARSER DIAGNOSTIC: getChapterPages(${chapterId}) returned 0 images.`);
      }
      return pages;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },
};
