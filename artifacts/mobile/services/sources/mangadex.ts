import { Platform } from "react-native";
import { Chapter, Manga, MangaSource } from "./types";

const BASE = "https://api.mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";

const isWeb = Platform.OS === "web";
const proxyBase = isWeb
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/manga-proxy`
  : BASE;

function coverUrl(mangaId: string, fileName: string): string {
  if (isWeb) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/manga-proxy/uploads/${mangaId}/${fileName}.512.jpg`;
  }
  return `${COVERS}/${mangaId}/${fileName}.512.jpg`;
}

function parseMangaData(data: Record<string, unknown>): Manga {
  const attrs = data.attributes as Record<string, unknown>;
  const titleObj = (attrs.title as Record<string, string>) || {};
  const title =
    titleObj.en ||
    titleObj["ja-ro"] ||
    (Object.values(titleObj)[0] as string) ||
    "Unknown";

  const descObj = (attrs.description as Record<string, string>) || {};
  const description =
    descObj.en || (Object.values(descObj)[0] as string) || "";

  const relationships = (data.relationships as Array<Record<string, unknown>>) || [];
  const coverRel = relationships.find((r) => r.type === "cover_art");
  const authorRel = relationships.find((r) => r.type === "author");

  const coverFile = coverRel
    ? ((coverRel.attributes as Record<string, string>)?.fileName ?? "")
    : "";

  const tags = (attrs.tags as Array<Record<string, unknown>>) || [];
  const genres = tags
    .filter((t) => {
      const ta = t.attributes as Record<string, unknown>;
      return ta?.group === "genre";
    })
    .map((t) => {
      const ta = t.attributes as Record<string, unknown>;
      const name = ta.name as Record<string, string>;
      return name?.en || (Object.values(name || {})[0] as string) || "";
    })
    .filter(Boolean);

  const ratingObj = attrs.rating as Record<string, number> | undefined;

  return {
    id: data.id as string,
    title: String(title),
    coverUrl: coverFile ? coverUrl(data.id as string, coverFile) : "",
    sourceId: "mangadex",
    status: attrs.status as Manga["status"],
    rating: ratingObj?.average,
    description: String(description),
    genres,
    author: (authorRel?.attributes as Record<string, string>)?.name,
    year: attrs.year as number | undefined,
    contentRating: attrs.contentRating as string | undefined,
  };
}

async function apiFetch(path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const url = isWeb ? `${proxyBase}${path}` : `${BASE}${path}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`MangaDex API error: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildParams(base: Record<string, string>, arrays: Record<string, string[]> = {}): string {
  const p = new URLSearchParams(base);
  for (const [key, values] of Object.entries(arrays)) {
    values.forEach((v) => p.append(key, v));
  }
  return p.toString();
}

export const mangadexSource: MangaSource = {
  id: "mangadex",
  name: "MangaDex",
  baseUrl: "https://mangadex.org",
  isEnabled: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { title: query, limit: "20", offset: String(page * 20) },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const data = await apiFetch(`/manga?${qs}`);
    return ((data.data as unknown[]) || []).map((d) =>
      parseMangaData(d as Record<string, unknown>)
    );
  },

  async getTrending(page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { limit: "20", offset: String(page * 20), "order[followedCount]": "desc" },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const data = await apiFetch(`/manga?${qs}`);
    return ((data.data as unknown[]) || []).map((d) =>
      parseMangaData(d as Record<string, unknown>)
    );
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { limit: "20", offset: String(page * 20), "order[latestUploadedChapter]": "desc" },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const data = await apiFetch(`/manga?${qs}`);
    return ((data.data as unknown[]) || []).map((d) =>
      parseMangaData(d as Record<string, unknown>)
    );
  },

  async getMangaDetails(id: string): Promise<Manga> {
    const qs = buildParams(
      {},
      { "includes[]": ["cover_art", "author", "artist"] }
    );
    const data = await apiFetch(`/manga/${id}?${qs}`);
    return parseMangaData(data.data as Record<string, unknown>);
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const qs = buildParams(
      { limit: "100", "order[chapter]": "desc" },
      { "translatedLanguage[]": ["en"], "includes[]": ["scanlation_group"] }
    );
    const data = await apiFetch(`/manga/${mangaId}/feed?${qs}`);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const c of (data.data as Array<Record<string, unknown>>) || []) {
      const attrs = c.attributes as Record<string, unknown>;
      const num = (attrs.chapter as string) || "?";
      if (seen.has(num)) continue;
      seen.add(num);

      const rels = (c.relationships as Array<Record<string, unknown>>) || [];
      const groupRel = rels.find((r) => r.type === "scanlation_group");

      chapters.push({
        id: c.id as string,
        number: num,
        title: attrs.title as string | undefined,
        publishedAt: attrs.publishAt as string,
        pages: attrs.pages as number | undefined,
        translatedLanguage: attrs.translatedLanguage as string | undefined,
        scanlator: (groupRel?.attributes as Record<string, string>)?.name,
      });
    }
    return chapters;
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    const data = await apiFetch(`/at-home/server/${chapterId}`);
    const baseUrl = data.baseUrl as string;
    const chapter = data.chapter as Record<string, unknown>;
    const files = (chapter.data as string[]) || [];
    return files.map((file) => `${baseUrl}/data/${chapter.hash as string}/${file}`);
  },
};
