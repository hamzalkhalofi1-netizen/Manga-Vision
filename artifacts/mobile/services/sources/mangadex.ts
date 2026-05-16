import { Platform } from "react-native";
import { Chapter, Manga, MangaSource } from "./types";

const BASE = "https://api.mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";

const isWeb = Platform.OS === "web";
const proxyBase = isWeb
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/manga-proxy`
  : BASE;

function coverUrl(mangaId: string, fileName: string): string {
  if (!mangaId || !fileName) return "";
  if (isWeb) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/manga-proxy/uploads/${mangaId}/${fileName}.512.jpg`;
  }
  return `${COVERS}/${mangaId}/${fileName}.512.jpg`;
}

function safeStr(val: unknown, fallback = ""): string {
  if (typeof val === "string" && val.trim()) return val.trim();
  return fallback;
}

function parseMangaData(data: unknown): Manga {
  if (!data || typeof data !== "object") {
    return { id: "", title: "Unknown", coverUrl: "", sourceId: "mangadex" };
  }
  const item = data as Record<string, unknown>;
  const attrs = (item.attributes && typeof item.attributes === "object"
    ? item.attributes
    : {}) as Record<string, unknown>;

  const titleObj = (attrs.title && typeof attrs.title === "object"
    ? attrs.title
    : {}) as Record<string, string>;
  const title =
    safeStr(titleObj.en) ||
    safeStr(titleObj["ja-ro"]) ||
    safeStr(Object.values(titleObj)[0]) ||
    "Unknown";

  const descObj = (attrs.description && typeof attrs.description === "object"
    ? attrs.description
    : {}) as Record<string, string>;
  const description =
    safeStr(descObj.en) || safeStr(Object.values(descObj)[0]);

  const relationships = Array.isArray(item.relationships) ? item.relationships : [];
  const coverRel = relationships.find(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && (r as Record<string, unknown>).type === "cover_art"
  );
  const authorRel = relationships.find(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && (r as Record<string, unknown>).type === "author"
  );

  const coverAttrs = (coverRel?.attributes && typeof coverRel.attributes === "object"
    ? coverRel.attributes
    : {}) as Record<string, string>;
  const coverFile = safeStr(coverAttrs.fileName);

  const tags = Array.isArray(attrs.tags) ? attrs.tags : [];
  const genres = (tags as unknown[])
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
    .filter((t) => {
      const ta = (t.attributes && typeof t.attributes === "object" ? t.attributes : {}) as Record<string, unknown>;
      return ta?.group === "genre";
    })
    .map((t) => {
      const ta = (t.attributes && typeof t.attributes === "object" ? t.attributes : {}) as Record<string, unknown>;
      const name = (ta.name && typeof ta.name === "object" ? ta.name : {}) as Record<string, string>;
      return safeStr(name?.en) || safeStr(Object.values(name || {})[0]);
    })
    .filter(Boolean) as string[];

  const ratingObj = (attrs.rating && typeof attrs.rating === "object"
    ? attrs.rating
    : {}) as Record<string, number>;
  const authorAttrs = (authorRel?.attributes && typeof authorRel.attributes === "object"
    ? authorRel.attributes
    : {}) as Record<string, string>;

  return {
    id: safeStr(item.id as string) || String(item.id ?? ""),
    title,
    coverUrl: coverFile ? coverUrl(safeStr(item.id as string), coverFile) : "",
    sourceId: "mangadex",
    status: safeStr(attrs.status as string) as Manga["status"] || undefined,
    rating: typeof ratingObj?.average === "number" ? ratingObj.average : undefined,
    description,
    genres,
    author: safeStr(authorAttrs.name) || undefined,
    year: typeof attrs.year === "number" ? attrs.year : undefined,
    contentRating: safeStr(attrs.contentRating as string) || undefined,
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
    if (!res.ok) throw new Error(`MangaDex API error: ${res.status} for ${path}`);
    const json = await res.json();
    if (json.result === "error") {
      throw new Error(`MangaDex error: ${json.errors?.[0]?.detail ?? "Unknown error"}`);
    }
    return json;
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
    return ((data.data as unknown[]) || []).map(parseMangaData).filter((m) => m.id);
  },

  async getTrending(page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { limit: "20", offset: String(page * 20), "order[followedCount]": "desc" },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const data = await apiFetch(`/manga?${qs}`);
    return ((data.data as unknown[]) || []).map(parseMangaData).filter((m) => m.id);
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { limit: "20", offset: String(page * 20), "order[latestUploadedChapter]": "desc" },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const data = await apiFetch(`/manga?${qs}`);
    return ((data.data as unknown[]) || []).map(parseMangaData).filter((m) => m.id);
  },

  async getMangaDetails(id: string): Promise<Manga> {
    if (!id) throw new Error("Manga ID is required");
    const qs = buildParams(
      {},
      { "includes[]": ["cover_art", "author", "artist"] }
    );
    const data = await apiFetch(`/manga/${id}?${qs}`);
    const manga = parseMangaData(data.data);
    if (!manga.id) throw new Error("Failed to parse manga details");
    return manga;
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    if (!mangaId) return [];
    const qs = buildParams(
      { limit: "100", "order[chapter]": "desc" },
      { "translatedLanguage[]": ["en"], "includes[]": ["scanlation_group"] }
    );
    const data = await apiFetch(`/manga/${mangaId}/feed?${qs}`);
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    for (const c of (data.data as Array<unknown>) || []) {
      if (!c || typeof c !== "object") continue;
      const item = c as Record<string, unknown>;
      const attrs = (item.attributes && typeof item.attributes === "object"
        ? item.attributes : {}) as Record<string, unknown>;
      const num = safeStr(attrs.chapter as string) || "?";
      if (seen.has(num)) continue;
      seen.add(num);

      const rels = Array.isArray(item.relationships) ? item.relationships : [];
      const groupRel = rels.find(
        (r): r is Record<string, unknown> =>
          r !== null && typeof r === "object" && (r as Record<string, unknown>).type === "scanlation_group"
      );
      const groupAttrs = (groupRel?.attributes && typeof groupRel.attributes === "object"
        ? groupRel.attributes : {}) as Record<string, string>;

      chapters.push({
        id: safeStr(item.id as string),
        number: num,
        title: safeStr(attrs.title as string) || undefined,
        publishedAt: safeStr(attrs.publishAt as string),
        pages: typeof attrs.pages === "number" ? attrs.pages : undefined,
        translatedLanguage: safeStr(attrs.translatedLanguage as string) || undefined,
        scanlator: safeStr(groupAttrs.name) || undefined,
      });
    }
    return chapters;
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    if (!chapterId) return [];
    const data = await apiFetch(`/at-home/server/${chapterId}`);
    const baseUrl = safeStr(data.baseUrl as string);
    const chapter = (data.chapter && typeof data.chapter === "object"
      ? data.chapter : {}) as Record<string, unknown>;
    const hash = safeStr(chapter.hash as string);
    const files = Array.isArray(chapter.data) ? chapter.data : [];
    if (!baseUrl || !hash) return [];
    return files
      .filter((f): f is string => typeof f === "string" && f.length > 0)
      .map((file) => `${baseUrl}/data/${hash}/${file}`);
  },
};
