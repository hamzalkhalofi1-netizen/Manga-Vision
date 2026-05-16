import { Chapter, Manga, MangaSource } from "./types";

const BASE = "https://www.webtoons.com";
const CANVAS_API = "https://www.webtoons.com/en/api";

async function naverFetch(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; MangaVerse/1.0)",
        Referer: "https://www.webtoons.com/",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Naver Webtoon error: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

type NTitle = {
  titleNo?: number;
  title?: string;
  writingAuthorName?: string;
  representAuthorName?: string;
  thumbnailUrl?: string;
  starScoreAverage?: number;
  readCount?: number;
  genre?: string;
  webtoonLike?: number;
};

function parseWebtoon(t: NTitle): Manga {
  return {
    id: String(t.titleNo ?? ""),
    title: t.title ?? "Unknown",
    coverUrl: t.thumbnailUrl ?? "",
    sourceId: "naver",
    status: "ongoing",
    author: t.writingAuthorName ?? t.representAuthorName,
    rating: t.starScoreAverage,
    genres: t.genre ? [t.genre] : ["Webtoon"],
    description: "",
  };
}

export const naverSource: MangaSource = {
  id: "naver",
  name: "Naver Webtoon",
  baseUrl: "https://www.webtoons.com",
  isEnabled: true,

  async getTrending(): Promise<Manga[]> {
    try {
      const url = `${BASE}/en/api/webtoon/popular/list?lang=en&sortOrder=READ_COUNT&contentType=WEBTOON&startIndex=1&pageSize=20`;
      const data = await naverFetch(url);
      const items = (data.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
      return items.map(parseWebtoon);
    } catch {
      try {
        const url2 = `${BASE}/en/api/webtoon/top/list?lang=en&startIndex=1&pageSize=20`;
        const data2 = await naverFetch(url2);
        const items2 = (data2.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
        return items2.map(parseWebtoon);
      } catch {
        return [];
      }
    }
  },

  async search(query: string): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ query, searchType: "WEBTOON", startIndex: "1", pageSize: "20" });
      const url = `${BASE}/en/search?${qs}`;
      const data = await naverFetch(url);
      const items = (data.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
      return items.map(parseWebtoon);
    } catch {
      return [];
    }
  },

  async getLatestUpdates(): Promise<Manga[]> {
    try {
      const url = `${BASE}/en/api/webtoon/popular/list?lang=en&sortOrder=UPDATE&contentType=WEBTOON&startIndex=1&pageSize=20`;
      const data = await naverFetch(url);
      const items = (data.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
      return items.map(parseWebtoon);
    } catch {
      return [];
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    return { id, title: "Webtoon", coverUrl: "", sourceId: "naver", description: "Visit Naver Webtoon to read this title." };
  },

  async getChapters(): Promise<Chapter[]> {
    return [];
  },

  async getChapterPages(): Promise<string[]> {
    return [];
  },
};
