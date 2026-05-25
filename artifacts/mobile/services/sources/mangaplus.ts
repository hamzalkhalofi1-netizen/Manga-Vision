import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch } from "./fetchClient";

const SITE_URL = "https://mangaplus.shueisha.co.jp";
const API_BASE = "https://api.mangaplus.shueisha.co.jp/v3";

const FETCH_OPTS = {
  sourceId: "mangaplus",
  siteUrl: SITE_URL,
  timeoutMs: 12000,
  headers: {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; MangaVerse/1.0)",
  },
};

type MPTitle = {
  titleId?: number;
  name?: string;
  author?: string;
  portraitImageUrl?: string;
  landscapeImageUrl?: string;
};

type MPChapter = {
  chapterId?: number;
  name?: string;
  subTitle?: string;
  startTimeStamp?: number;
};

async function mpFetch(path: string): Promise<Record<string, unknown>> {
  const res = await proxiedFetch("mangaplus", path, "", {
    ...FETCH_OPTS,
    siteUrl: API_BASE,
    directOnWeb: true,
  });
  return res.json();
}

function parseTitle(t: MPTitle): Manga {
  return {
    id: String(t.titleId ?? ""),
    title: t.name ?? "Unknown",
    coverUrl: t.portraitImageUrl ?? t.landscapeImageUrl ?? "",
    sourceId: "mangaplus",
    status: "ongoing",
    author: t.author,
    description: "",
    genres: ["Official"],
  };
}

export const mangaplusSource: MangaSource = {
  id: "mangaplus",
  name: "MANGA Plus",
  baseUrl: SITE_URL,
  isEnabled: true,

  async getTrending(): Promise<Manga[]> {
    try {
      const data = await mpFetch("/api_page/home?lang=0");
      const groups = data.data as Record<string, unknown> | undefined;
      const ranking = (groups?.titleRanking as { titles?: MPTitle[] })?.titles ?? [];
      const featured = (groups?.featuredTitles as { titles?: MPTitle[] })?.titles ?? [];
      return [...ranking, ...featured].filter(Boolean).slice(0, 20).map(parseTitle);
    } catch {
      return [];
    }
  },

  async search(query: string): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ query, lang: "0" }).toString();
      const data = await mpFetch(`/api_page/search?${qs}`);
      const result = data.data as Record<string, unknown> | undefined;
      return ((result?.titles as MPTitle[]) ?? []).slice(0, 20).map(parseTitle);
    } catch {
      return [];
    }
  },

  async getLatestUpdates(): Promise<Manga[]> {
    try {
      const data = await mpFetch("/api_page/home?lang=0");
      const groups = data.data as Record<string, unknown> | undefined;
      const updated = (groups?.newTitleList as { titles?: MPTitle[] })?.titles ?? [];
      return updated.slice(0, 20).map(parseTitle);
    } catch {
      return [];
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const data = await mpFetch(`/api_page/title?title_id=${id}&lang=0`);
      const result = data.data as Record<string, unknown> | undefined;
      const title = result?.titleDetailView as Record<string, unknown> | undefined;
      if (!title) throw new Error("Not found");
      const t = title.title as MPTitle;
      return {
        ...parseTitle(t),
        description: (title.overview as string | undefined) ?? "",
        chaptersCount: (title.chapterListGroup as unknown[])?.length,
      };
    } catch {
      return { id, title: "Unknown", coverUrl: "", sourceId: "mangaplus" };
    }
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      const data = await mpFetch(`/api_page/title?title_id=${mangaId}&lang=0`);
      const result = data.data as Record<string, unknown> | undefined;
      const titleDetail = result?.titleDetailView as Record<string, unknown> | undefined;
      const groups = (titleDetail?.chapterListGroup as Array<Record<string, unknown>>) ?? [];
      const chapters: Chapter[] = [];
      for (const group of groups) {
        const list = ((group.firstChapterList ?? group.lastChapterList) as MPChapter[] | undefined) ?? [];
        for (const c of list) {
          if (!c?.chapterId) continue;
          chapters.push({
            id: String(c.chapterId),
            number: c.name?.replace("#", "") ?? "?",
            title: c.subTitle,
            publishedAt: c.startTimeStamp
              ? new Date(c.startTimeStamp * 1000).toISOString()
              : "",
          });
        }
      }
      return chapters.reverse();
    } catch {
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    try {
      const data = await mpFetch(
        `/api_page/chapter_viewer?chapter_id=${chapterId}&split=yes&img_quality=low`,
      );
      const result = data.data as Record<string, unknown> | undefined;
      const viewer = (result?.mangaPlusPage ?? result?.chapterViewer) as
        | Record<string, unknown>
        | undefined;
      const pages = (viewer?.pages as Array<Record<string, unknown>>) ?? [];
      return pages
        .map((p) => (p.page as Record<string, unknown>)?.imageUrl as string | undefined)
        .filter((u): u is string => !!u);
    } catch {
      return [];
    }
  },
};
