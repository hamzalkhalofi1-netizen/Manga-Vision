import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";

const SITE_URL = "https://mangafire.to";

const FETCH_OPTS = {
  sourceId: "mangafire",
  siteUrl: SITE_URL,
  timeoutMs: 15000,
  headers: {
    Accept: "application/json, text/html, */*",
    "X-Requested-With": "XMLHttpRequest",
  },
};

// Defensive parsers for MangaFire AJAX responses which can change format

function parseMangaEntry(entry: unknown): Manga | null {
  if (!entry || typeof entry !== "object") return null;
  const item = entry as Record<string, unknown>;

  // MangaFire search result can be an array [slug, imgSrc, title, type, ...]
  if (Array.isArray(item)) {
    const arr = item as unknown[];
    const id = typeof arr[0] === "string" ? arr[0] : "";
    const coverUrl = typeof arr[1] === "string" ? arr[1] : "";
    const title = typeof arr[2] === "string" ? arr[2] : "";
    if (!id && !title) return null;
    return { id, title, coverUrl, sourceId: "mangafire" };
  }

  const id = (item.id ?? item.slug ?? item.hid ?? "") as string;
  const title = (item.title ?? item.name ?? item.manga ?? "") as string;
  const coverUrl = (item.poster ?? item.cover ?? item.thumbnail ?? item.img ?? "") as string;
  const status = typeof item.status === "number"
    ? item.status === 1 ? "ongoing" : item.status === 2 ? "completed" : undefined
    : undefined;
  const rating = typeof item.rating === "number" ? item.rating : undefined;

  if (!id && !title) return null;

  return {
    id,
    title,
    coverUrl,
    sourceId: "mangafire",
    status,
    rating,
    genres: Array.isArray(item.genres)
      ? (item.genres as string[]).filter((g) => typeof g === "string")
      : [],
  };
}

async function mfFetch(path: string, query = ""): Promise<unknown> {
  const res = await proxiedFetch("mangafire", path, query, FETCH_OPTS);
  return res.json();
}

async function mfFetchHtml(path: string, query = ""): Promise<string> {
  const res = await proxiedFetch("mangafire", path, query, {
    ...FETCH_OPTS,
    headers: { Accept: "text/html,application/xhtml+xml,*/*" },
  });
  return res.text();
}

function extractMangasFromHtml(html: string): Manga[] {
  const results: Manga[] = [];
  // Match card-style entries: data-id or slug in URLs
  const unitRe = /href="\/manga\/([\w-]+)"[^>]*>\s*<img[^>]+src="([^"]+)"[^>]*>[^<]*<\/[^>]+>\s*<[^>]+>([^<]{2,80})</g;
  let match: RegExpExecArray | null;
  while ((match = unitRe.exec(html)) !== null) {
    const [, slug, cover, title] = match;
    if (slug && title) {
      results.push({ id: slug, title: title.trim(), coverUrl: cover ?? "", sourceId: "mangafire" });
    }
  }
  return results;
}

export const mangafireSource: MangaSource = {
  id: "mangafire",
  name: "MangaFire",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ keyword: query, page: String(page + 1) }).toString();
      const data = await mfFetch("/ajax/manga/search", `?${qs}`) as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      const mangas = (result?.mangas ?? result?.data ?? data.mangas ?? []) as unknown[];
      const parsed = mangas.map(parseMangaEntry).filter((m): m is Manga => m !== null);
      if (parsed.length > 0) return parsed;
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
    }
    // HTML fallback
    try {
      const qs = new URLSearchParams({ keyword: query, page: String(page + 1) }).toString();
      const html = await mfFetchHtml("/filter", `?${qs}`);
      return extractMangasFromHtml(html);
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getTrending(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ page: String(page + 1), sortby: "trending" }).toString();
      const data = await mfFetch("/ajax/manga/list", `?${qs}`) as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      const mangas = (result?.mangas ?? result?.data ?? []) as unknown[];
      const parsed = mangas.map(parseMangaEntry).filter((m): m is Manga => m !== null);
      if (parsed.length > 0) return parsed;
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
    }
    try {
      const qs = new URLSearchParams({ page: String(page + 1), sortby: "trending" }).toString();
      const html = await mfFetchHtml("/filter", `?${qs}`);
      return extractMangasFromHtml(html);
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ page: String(page + 1), sortby: "latest" }).toString();
      const data = await mfFetch("/ajax/manga/list", `?${qs}`) as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      const mangas = (result?.mangas ?? result?.data ?? []) as unknown[];
      const parsed = mangas.map(parseMangaEntry).filter((m): m is Manga => m !== null);
      if (parsed.length > 0) return parsed;
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
    }
    try {
      const qs = new URLSearchParams({ page: String(page + 1), sortby: "latest" }).toString();
      const html = await mfFetchHtml("/filter", `?${qs}`);
      return extractMangasFromHtml(html);
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const data = await mfFetch(`/ajax/manga/${id}/info`, "") as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      const parsed = parseMangaEntry(result ?? data);
      if (parsed) return { ...parsed, id };
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
    }
    try {
      const html = await mfFetchHtml(`/manga/${id}`);
      const titleMatch = html.match(/<h1[^>]*>([^<]{2,120})<\/h1>/);
      const imgMatch = html.match(/class="poster"[^>]*>\s*<img[^>]+src="([^"]+)"/);
      return {
        id,
        title: titleMatch?.[1]?.trim() ?? id,
        coverUrl: imgMatch?.[1] ?? "",
        sourceId: "mangafire",
      };
    } catch {
      return { id, title: id, coverUrl: "", sourceId: "mangafire" };
    }
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      const data = await mfFetch(`/ajax/manga/${mangaId}/chapter/en`, "") as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      const chapters = (result?.chapters ?? data.chapters ?? []) as Array<Record<string, unknown>>;
      return chapters.map((c) => ({
        id: String(c.id ?? c.chapterId ?? ""),
        number: String(c.number ?? c.chapter ?? c.num ?? "?"),
        title: c.title ? String(c.title) : undefined,
        publishedAt: String(c.date ?? c.created_at ?? c.publishedAt ?? ""),
      }));
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    try {
      const data = await mfFetch(`/ajax/chapter/${chapterId}`, "") as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      const raw = result?.images ?? data.images ?? result?.pages ?? data.pages ?? [];
      const images = Array.isArray(raw) ? raw : [];
      return images
        .map((img: unknown) => {
          if (typeof img === "string") return img;
          if (Array.isArray(img) && typeof img[0] === "string") return img[0] as string;
          if (img && typeof img === "object") {
            const o = img as Record<string, unknown>;
            return (o.url ?? o.src ?? o.imageUrl ?? "") as string;
          }
          return "";
        })
        .filter((u) => u.startsWith("http"));
    } catch (err) {
      if (err instanceof SourceError && err.type === "cloudflare") throw err;
      return [];
    }
  },
};
