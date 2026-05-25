import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";

const SITE_URL = "https://asuracomic.net";

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

async function asuraJsonFetch(path: string, query = ""): Promise<unknown> {
  const res = await proxiedFetch("asura", path, query, {
    ...FETCH_OPTS,
    headers: { Accept: "application/json, */*" },
  });
  return res.json();
}

function parseHtmlMangaList(html: string): Manga[] {
  const results: Manga[] = [];
  // Match series card links — asura uses /series/{slug}
  const re =
    /href="\/series\/([\w-]+)"[^>]*>[\s\S]{0,400}?<img[^>]+src="([^"]+)"[^>]*>[\s\S]{0,200}?<span[^>]*>([^<]{2,120})<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, slug, cover, title] = m;
    if (slug && title) {
      results.push({ id: slug, title: title.trim(), coverUrl: cover ?? "", sourceId: "asura" });
    }
  }
  // Broader fallback: series grid items
  if (results.length === 0) {
    const re2 = /\/series\/([\w-]+)/g;
    const seen = new Set<string>();
    let m2: RegExpExecArray | null;
    while ((m2 = re2.exec(html)) !== null) {
      if (!seen.has(m2[1])) {
        seen.add(m2[1]);
        results.push({ id: m2[1], title: m2[1].replace(/-/g, " "), coverUrl: "", sourceId: "asura" });
      }
    }
  }
  return results.slice(0, 20);
}

function safeJson(html: string): unknown {
  // Try to find embedded __NEXT_DATA__ JSON for Next.js pages
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (match?.[1]) {
    try { return JSON.parse(match[1]); } catch {}
  }
  return null;
}

function extractMangasFromNextData(data: unknown): Manga[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const props = d.props as Record<string, unknown> | undefined;
  const pageProps = props?.pageProps as Record<string, unknown> | undefined;
  const series =
    pageProps?.series ??
    pageProps?.comics ??
    pageProps?.data ??
    pageProps?.results;
  if (!Array.isArray(series)) return [];
  return series.map((item: unknown) => {
    if (!item || typeof item !== "object") return null;
    const i = item as Record<string, unknown>;
    return {
      id: (i.slug ?? i.id ?? i.series_slug ?? "") as string,
      title: (i.title ?? i.name ?? "") as string,
      coverUrl: (i.thumbnail ?? i.cover ?? i.image ?? "") as string,
      sourceId: "asura",
      status: i.status === "Completed" ? "completed" : "ongoing",
    } satisfies Manga;
  }).filter((m): m is Manga => m !== null && m.id.length > 0);
}

export const asuraSource: MangaSource = {
  id: "asura",
  name: "Asura Scans",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ name: query, page: String(page + 1) }).toString();
      // Try JSON API first (Next.js internal)
      try {
        const json = await asuraJsonFetch("/series", `?${qs}`);
        const extracted = extractMangasFromNextData(json);
        if (extracted.length > 0) return extracted;
      } catch (err) {
        if (err instanceof SourceError && err.type === "cloudflare") throw err;
      }
      // HTML fallback
      const html = await asuraFetch("/series", `?${qs}`);
      const fromNext = safeJson(html);
      if (fromNext) {
        const extracted = extractMangasFromNextData(fromNext);
        if (extracted.length > 0) return extracted;
      }
      return parseHtmlMangaList(html).filter(
        (m) => !query || m.title.toLowerCase().includes(query.toLowerCase()),
      );
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getTrending(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ page: String(page + 1), order: "rating" }).toString();
      const html = await asuraFetch("/series", `?${qs}`);
      const fromNext = safeJson(html);
      if (fromNext) {
        const extracted = extractMangasFromNextData(fromNext);
        if (extracted.length > 0) return extracted;
      }
      return parseHtmlMangaList(html);
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ page: String(page + 1), order: "update" }).toString();
      const html = await asuraFetch("/series", `?${qs}`);
      const fromNext = safeJson(html);
      if (fromNext) {
        const extracted = extractMangasFromNextData(fromNext);
        if (extracted.length > 0) return extracted;
      }
      return parseHtmlMangaList(html);
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const html = await asuraFetch(`/series/${id}`);
      const fromNext = safeJson(html);
      if (fromNext) {
        const d = fromNext as Record<string, unknown>;
        const props = (d.props as Record<string, unknown>)?.pageProps as Record<string, unknown> | undefined;
        const s = (props?.series ?? props?.data ?? props?.comic) as Record<string, unknown> | undefined;
        if (s) {
          return {
            id,
            title: (s.title ?? s.name ?? id) as string,
            coverUrl: (s.thumbnail ?? s.cover ?? s.image ?? "") as string,
            sourceId: "asura",
            status: s.status === "Completed" ? "completed" : "ongoing",
            description: (s.synopsis ?? s.description ?? s.desc ?? "") as string,
            author: (s.author ?? s.creator ?? "") as string,
            genres: Array.isArray(s.genres)
              ? (s.genres as Array<Record<string, unknown>>).map(
                  (g) => (g.name ?? g) as string,
                )
              : [],
          };
        }
      }
      // Simple regex fallback
      const titleMatch = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i);
      const coverMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
      return {
        id,
        title: titleMatch?.[1]?.trim() ?? id.replace(/-/g, " "),
        coverUrl: coverMatch?.[1] ?? "",
        sourceId: "asura",
      };
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return { id, title: id.replace(/-/g, " "), coverUrl: "", sourceId: "asura" };
    }
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      const html = await asuraFetch(`/series/${mangaId}`);
      const fromNext = safeJson(html);
      if (fromNext) {
        const d = fromNext as Record<string, unknown>;
        const props = (d.props as Record<string, unknown>)?.pageProps as Record<string, unknown> | undefined;
        const chapters =
          (props?.chapters ?? props?.episodes ?? props?.chapterList) as
            | Array<Record<string, unknown>>
            | undefined;
        if (Array.isArray(chapters) && chapters.length > 0) {
          return chapters.map((c) => ({
            id: (c.id ?? c.chapter_id ?? c.slug ?? "") as string,
            number: String(c.number ?? c.chapter ?? c.chap ?? "?"),
            title: c.title ? String(c.title) : undefined,
            publishedAt: (c.publishedAt ?? c.updated_at ?? c.date ?? "") as string,
          }));
        }
      }
      // Regex fallback from HTML chapter list
      const chapters: Chapter[] = [];
      const re = /href="\/series\/[\w-]+\/(chapter-[\w-]+)"[^>]*>[\s\S]{0,50}?Chapter\s*([\d.]+)/gi;
      let m: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((m = re.exec(html)) !== null) {
        const slug = m[1];
        const num = m[2];
        if (!seen.has(slug)) {
          seen.add(slug);
          chapters.push({ id: slug, number: num, publishedAt: "" });
        }
      }
      return chapters;
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    try {
      // chapterId for Asura is usually "series-slug/chapter-N"
      const path = chapterId.startsWith("/") ? chapterId : `/${chapterId}`;
      const html = await asuraFetch(path);
      const fromNext = safeJson(html);
      if (fromNext) {
        const d = fromNext as Record<string, unknown>;
        const props = (d.props as Record<string, unknown>)?.pageProps as Record<string, unknown> | undefined;
        const pages = (props?.pages ?? props?.images ?? props?.chapter?.images) as
          | Array<string | Record<string, unknown>>
          | undefined;
        if (Array.isArray(pages) && pages.length > 0) {
          return pages
            .map((p) => (typeof p === "string" ? p : (p as Record<string, unknown>).url as string))
            .filter((u): u is string => typeof u === "string" && u.startsWith("http"));
        }
      }
      // Regex fallback: find CDN image URLs
      const imgRe =
        /(https?:\/\/(?:cdn\.|img\.|static\.|gg\.)?asura[^"'\s]{4,200}\.(?:jpg|jpeg|png|webp))/gi;
      const urls = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = imgRe.exec(html)) !== null) urls.add(m[1]);
      return [...urls];
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },
};
