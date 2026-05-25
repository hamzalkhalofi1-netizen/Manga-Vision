import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch } from "./fetchClient";

const SITE_URL = "https://comick.io";
const API_URL = "https://api.comick.io";
const CDN = "https://meo.comick.pictures";

const FETCH_OPTS = {
  sourceId: "comick",
  siteUrl: SITE_URL,
  timeoutMs: 15000,
};

function coverUrl(coverPath: string | undefined): string {
  if (!coverPath) return "";
  if (coverPath.startsWith("http")) return coverPath;
  return `${CDN}/${coverPath}`;
}

function parseComic(item: Record<string, unknown>): Manga {
  const mdCovers = (item.md_covers as Array<Record<string, unknown>>) ?? [];
  const firstCover = mdCovers[0];
  const cover = firstCover
    ? coverUrl((firstCover.gpurl ?? firstCover.b2key) as string | undefined)
    : "";

  const genres: string[] = [];
  const tagsRaw = (item.genres as Array<Record<string, unknown>>) ?? [];
  tagsRaw.forEach((t) => { if (t.name) genres.push(t.name as string); });

  let status: Manga["status"] = "ongoing";
  const statusNum = item.status as number | undefined;
  if (statusNum === 2) status = "completed";
  else if (statusNum === 3) status = "cancelled";
  else if (statusNum === 4) status = "hiatus";

  return {
    id: (item.hid ?? item.slug ?? String(item.id)) as string,
    title: (item.title ?? item.slug ?? "") as string,
    coverUrl: cover,
    sourceId: "comick",
    status,
    rating: item.rating ? parseFloat(String(item.rating)) : undefined,
    description: (item.desc ?? item.parsed ?? "") as string,
    genres,
    year: item.year as number | undefined,
  };
}

async function comickFetch(path: string, query = ""): Promise<unknown> {
  const res = await proxiedFetch("comick-api", path, query, {
    ...FETCH_OPTS,
    siteUrl: API_URL,
    directOnWeb: true,
    headers: { Accept: "application/json" },
  });
  return res.json();
}

export const comickSource: MangaSource = {
  id: "comick",
  name: "Comick",
  baseUrl: SITE_URL,
  isEnabled: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    const qs = new URLSearchParams({
      q: query, limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const data = await comickFetch("/v1.0/search", `?${qs}`);
    const items = Array.isArray(data) ? data : ((data as Record<string, unknown>).result as unknown[]) ?? [];
    return items.map((d) => parseComic(d as Record<string, unknown>));
  },

  async getTrending(page = 0): Promise<Manga[]> {
    const qs = new URLSearchParams({
      sort: "follow", limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const data = await comickFetch("/v1.0/search", `?${qs}`);
    const items = Array.isArray(data) ? data : ((data as Record<string, unknown>).result as unknown[]) ?? [];
    return items.map((d) => parseComic(d as Record<string, unknown>));
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const qs = new URLSearchParams({
      sort: "uploaded", limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const data = await comickFetch("/v1.0/search", `?${qs}`);
    const items = Array.isArray(data) ? data : ((data as Record<string, unknown>).result as unknown[]) ?? [];
    return items.map((d) => parseComic(d as Record<string, unknown>));
  },

  async getMangaDetails(id: string): Promise<Manga> {
    const data = await comickFetch(`/comic/${id}`) as Record<string, unknown>;
    const comic = (data.comic ?? data) as Record<string, unknown>;
    return parseComic(comic);
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const qs = new URLSearchParams({ lang: "en", limit: "100", page: "1" }).toString();
    const data = await comickFetch(`/comic/${mangaId}/chapters`, `?${qs}`) as Record<string, unknown>;
    const chapters = (data.chapters as Array<Record<string, unknown>>) ?? [];
    return chapters.map((c) => ({
      id: (c.hid ?? c.id) as string,
      number: String(c.chap ?? c.chapter ?? "?"),
      title: c.title as string | undefined,
      publishedAt: (c.created_at ?? c.updated_at ?? "") as string,
      pages: c.images_count as number | undefined,
      translatedLanguage: "en",
      scanlator: ((c.group_name as string[]) ?? []).join(", ") || undefined,
    }));
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    const data = await comickFetch(`/chapter/${chapterId}`) as Record<string, unknown>;
    const images =
      (data.chapter as Record<string, unknown>)?.images ?? data.images ?? [];
    return (images as Array<Record<string, unknown>>).map((img) => {
      const url = (img.url ?? img.b2key ?? "") as string;
      if (url.startsWith("http")) return url;
      return `${CDN}/${url}`;
    });
  },
};
