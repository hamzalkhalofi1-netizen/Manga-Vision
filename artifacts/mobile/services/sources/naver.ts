import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";
import { SourceDiagnosticsLogger } from "./SourceDiagnosticsLogger";

const SITE_URL = "https://www.webtoons.com";
const diag = new SourceDiagnosticsLogger("naver");

const FETCH_OPTS = {
  sourceId: "naver",
  siteUrl: SITE_URL,
  timeoutMs: 15000,
  maxRetries: 2,
  headers: {
    Accept: "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: SITE_URL + "/",
    Origin: SITE_URL,
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
  synopsis?: string;
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
    description: t.synopsis ?? "",
  };
}

async function naverFetch(path: string, query = ""): Promise<Record<string, unknown>> {
  const res = await proxiedFetch("naver", path, query, FETCH_OPTS);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json") && !ct.includes("text/json")) {
    // Try to parse as JSON anyway — webtoons.com sometimes sends JSON without correct Content-Type
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      diag.log(`WARN: non-JSON response from ${path}, length=${text.length}`);
      return {};
    }
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// Try multiple API path patterns — webtoons.com internal API paths have changed over time.
async function fetchTitleList(
  sortOrder: "READ_COUNT" | "UPDATE",
  page: number,
): Promise<NTitle[]> {
  const startIndex = String(page * 20 + 1);

  // Pattern 1: /en/api/webtoon/popular/list (current)
  try {
    const qs = new URLSearchParams({
      lang: "en",
      sortOrder,
      contentType: "WEBTOON",
      startIndex,
      pageSize: "20",
    }).toString();
    const data = await naverFetch("/en/api/webtoon/popular/list", `?${qs}`);
    const result = data.result as Record<string, unknown> | undefined;
    const items = (result?.titleList ?? []) as NTitle[];
    if (items.length > 0) {
      diag.log(`fetchTitleList(${sortOrder}) p${page} → ${items.length} via /popular/list`);
      return items;
    }
  } catch (err) {
    diag.log(`Pattern 1 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Pattern 2: /en/api/webtoon/top/list
  try {
    const qs = new URLSearchParams({ lang: "en", startIndex, pageSize: "20" }).toString();
    const data = await naverFetch("/en/api/webtoon/top/list", `?${qs}`);
    const result = data.result as Record<string, unknown> | undefined;
    const items = (result?.titleList ?? []) as NTitle[];
    if (items.length > 0) {
      diag.log(`fetchTitleList(${sortOrder}) p${page} → ${items.length} via /top/list`);
      return items;
    }
  } catch (err) {
    diag.log(`Pattern 2 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Pattern 3: /en/api/challenge/popular/list (daily challenge webtoons)
  try {
    const qs = new URLSearchParams({
      lang: "en",
      sortOrder,
      startIndex,
      pageSize: "20",
    }).toString();
    const data = await naverFetch("/en/api/challenge/popular/list", `?${qs}`);
    const result = data.result as Record<string, unknown> | undefined;
    const items = (result?.titleList ?? []) as NTitle[];
    if (items.length > 0) {
      diag.log(`fetchTitleList(${sortOrder}) p${page} → ${items.length} via /challenge/popular/list`);
      return items;
    }
  } catch (err) {
    diag.log(`Pattern 3 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  diag.log(`WARN: fetchTitleList(${sortOrder}) p${page} → all patterns returned 0`);
  return [];
}

export const naverSource: MangaSource = {
  id: "naver",
  name: "Naver Webtoon",
  baseUrl: SITE_URL,
  isEnabled: true,

  async getTrending(page = 0): Promise<Manga[]> {
    try {
      const items = await fetchTitleList("READ_COUNT", page);
      return items.map(parseWebtoon);
    } catch {
      return [];
    }
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    try {
      const items = await fetchTitleList("UPDATE", page);
      return items.map(parseWebtoon);
    } catch {
      return [];
    }
  },

  async search(query: string, _page = 0): Promise<Manga[]> {
    if (!query.trim()) return [];
    try {
      const qs = new URLSearchParams({
        query,
        searchType: "WEBTOON",
        startIndex: "1",
        pageSize: "20",
        lang: "en",
      }).toString();
      const data = await naverFetch("/en/search", `?${qs}`);
      const result = data.result as Record<string, unknown> | undefined;
      const items = (result?.titleList ?? []) as NTitle[];
      diag.log(`search "${query}" → ${items.length}`);
      return items.map(parseWebtoon);
    } catch (err) {
      diag.log(`search error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const data = await naverFetch("/en/api/webtoon/detail", `?titleNo=${id}&lang=en`);
      const result = data.result as Record<string, unknown> | undefined;
      const title = result?.webtoonDetail as NTitle | undefined;
      if (title?.titleNo) {
        diag.log(`getMangaDetails(${id}) → ${title.title}`);
        return parseWebtoon(title);
      }
    } catch (err) {
      diag.log(`getMangaDetails(${id}) error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { id, title: "Webtoon", coverUrl: "", sourceId: "naver", description: "" };
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      const allEpisodes: Array<Record<string, unknown>> = [];
      let pageNo = 1;
      while (pageNo <= 5) {
        const qs = new URLSearchParams({
          titleNo: mangaId,
          pageSize: "100",
          pageNo: String(pageNo),
          lang: "en",
        }).toString();
        const data = await naverFetch("/en/api/webtoon/episode/list", `?${qs}`);
        const result = data.result as Record<string, unknown> | undefined;
        const episodes =
          (result?.episodeList ?? result?.episodes ?? []) as Array<Record<string, unknown>>;
        if (episodes.length === 0) break;
        allEpisodes.push(...episodes);
        if (episodes.length < 100) break;
        pageNo++;
      }
      diag.log(`getChapters(${mangaId}) → ${allEpisodes.length}`);
      return allEpisodes.map((ep) => ({
        id: `${mangaId}:${String(ep.episodeNo ?? ep.id ?? "")}`,
        number: String(ep.episodeNo ?? ep.number ?? "?"),
        title: ep.title ? String(ep.title) : undefined,
        publishedAt: ep.registerYmdt
          ? new Date(ep.registerYmdt as number).toISOString()
          : String(ep.registerDate ?? ep.date ?? ""),
      }));
    } catch (err) {
      diag.log(`getChapters(${mangaId}) error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    // chapterId format: "{titleNo}:{episodeNo}"
    // Naver's viewer is heavily JS-rendered; images require session tokens.
    // Return empty — the UI will offer to open in browser.
    void chapterId;
    return [];
  },
};
