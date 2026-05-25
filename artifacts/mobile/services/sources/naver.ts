import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch } from "./fetchClient";

const SITE_URL = "https://www.webtoons.com";

const FETCH_OPTS = {
  sourceId: "naver",
  siteUrl: SITE_URL,
  timeoutMs: 12000,
  headers: {
    Accept: "application/json, */*",
    "User-Agent": "Mozilla/5.0 (compatible; MangaVerse/1.0)",
  },
};

type NTitle = {
  titleNo?: number;
  title?: string;
  writingAuthorName?: string;
  representAuthorName?: string;
  thumbnailUrl?: string;
  starScoreAverage?: number;
  genre?: string;
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

async function naverFetch(path: string, query = ""): Promise<Record<string, unknown>> {
  const res = await proxiedFetch("naver", path, query, FETCH_OPTS);
  return res.json();
}

export const naverSource: MangaSource = {
  id: "naver",
  name: "Naver Webtoon",
  baseUrl: SITE_URL,
  isEnabled: true,

  async getTrending(): Promise<Manga[]> {
    try {
      const data = await naverFetch(
        "/en/api/webtoon/popular/list",
        "?lang=en&sortOrder=READ_COUNT&contentType=WEBTOON&startIndex=1&pageSize=20",
      );
      const items = (data.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
      if (items.length > 0) return items.map(parseWebtoon);
    } catch {}
    try {
      const data = await naverFetch(
        "/en/api/webtoon/top/list",
        "?lang=en&startIndex=1&pageSize=20",
      );
      const items = (data.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
      return items.map(parseWebtoon);
    } catch {
      return [];
    }
  },

  async search(query: string): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({
        query,
        searchType: "WEBTOON",
        startIndex: "1",
        pageSize: "20",
      }).toString();
      const data = await naverFetch("/en/search", `?${qs}`);
      const items = (data.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
      return items.map(parseWebtoon);
    } catch {
      return [];
    }
  },

  async getLatestUpdates(): Promise<Manga[]> {
    try {
      const data = await naverFetch(
        "/en/api/webtoon/popular/list",
        "?lang=en&sortOrder=UPDATE&contentType=WEBTOON&startIndex=1&pageSize=20",
      );
      const items = (data.result as Record<string, unknown>)?.titleList as NTitle[] ?? [];
      return items.map(parseWebtoon);
    } catch {
      return [];
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const data = await naverFetch(
        "/en/api/webtoon/detail",
        `?titleNo=${id}&lang=en`,
      );
      const result = data.result as Record<string, unknown> | undefined;
      const title = result?.webtoonDetail as NTitle | undefined;
      if (title && title.titleNo) return parseWebtoon(title);
    } catch {}
    return { id, title: "Webtoon", coverUrl: "", sourceId: "naver", description: "" };
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      // Naver episode list API
      const qs = new URLSearchParams({
        titleNo: mangaId,
        pageSize: "100",
        pageNo: "1",
        lang: "en",
      }).toString();
      const data = await naverFetch("/en/api/webtoon/episode/list", `?${qs}`);
      const result = data.result as Record<string, unknown> | undefined;
      const episodes =
        (result?.episodeList ?? result?.episodes ?? []) as Array<Record<string, unknown>>;
      if (episodes.length > 0) {
        return episodes.map((ep) => ({
          id: String(ep.episodeNo ?? ep.id ?? ""),
          number: String(ep.episodeNo ?? ep.number ?? "?"),
          title: ep.title ? String(ep.title) : undefined,
          publishedAt: String(ep.registerDate ?? ep.date ?? ep.publishedAt ?? ""),
        }));
      }
    } catch {}
    return [];
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    // chapterId format: "{titleNo}:{episodeNo}" or just episodeNo
    // Naver's viewer is heavily JS-rendered and geo-restricted.
    // Pages are served via XHR with session tokens — not publicly scrapable.
    // We return empty with a hint to open in browser.
    void chapterId;
    return [];
  },
};
