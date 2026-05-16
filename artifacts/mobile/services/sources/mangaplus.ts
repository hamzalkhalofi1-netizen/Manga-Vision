import { Chapter, Manga, MangaSource } from "./types";

const BASE = "https://api.mangaplus.shueisha.co.jp/v3";

type MPTitle = {
  titleId?: number;
  name?: string;
  author?: string;
  portraitImageUrl?: string;
  landscapeImageUrl?: string;
  viewCount?: number;
  language?: string;
};

type MPChapter = {
  chapterId?: number;
  name?: string;
  subTitle?: string;
  startTimeStamp?: number;
  isVerticalOnly?: boolean;
};

async function mpFetch(path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
        Origin: "https://mangaplus.shueisha.co.jp",
        Referer: "https://mangaplus.shueisha.co.jp/",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`MANGA Plus API error: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
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
  baseUrl: "https://mangaplus.shueisha.co.jp",
  isEnabled: true,

  async getTrending(): Promise<Manga[]> {
    try {
      const data = await mpFetch("/api_page/home?lang=0");
      const groups = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const ranking = (groups?.titleRanking as { titles?: MPTitle[] })?.titles ?? [];
      const featured = (groups?.featuredTitles as { titles?: MPTitle[] })?.titles ?? [];
      return [...ranking, ...featured].filter(Boolean).slice(0, 20).map(parseTitle);
    } catch {
      return [];
    }
  },

  async search(query: string): Promise<Manga[]> {
    try {
      const qs = new URLSearchParams({ query, lang: "0" });
      const data = await mpFetch(`/api_page/search?${qs}`);
      const result = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const titles = (result?.titles as MPTitle[]) ?? [];
      return titles.slice(0, 20).map(parseTitle);
    } catch {
      return [];
    }
  },

  async getLatestUpdates(): Promise<Manga[]> {
    try {
      const data = await mpFetch("/api_page/home?lang=0");
      const groups = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const updated = (groups?.newTitleList as { titles?: MPTitle[] })?.titles ?? [];
      return updated.slice(0, 20).map(parseTitle);
    } catch {
      return [];
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const data = await mpFetch(`/api_page/title?title_id=${id}&lang=0`);
      const result = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
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
      const result = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
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
            publishedAt: c.startTimeStamp ? new Date(c.startTimeStamp * 1000).toISOString() : "",
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
        `/api_page/chapter_viewer?chapter_id=${chapterId}&split=yes&img_quality=low`
      );
      const result = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const viewer = (result?.mangaPlusPage ?? result?.chapterViewer) as Record<string, unknown> | undefined;
      const pages = (viewer?.pages as Array<Record<string, unknown>>) ?? [];
      return pages
        .map((p) => (p.page as Record<string, unknown>)?.imageUrl as string | undefined)
        .filter((u): u is string => !!u);
    } catch {
      return [];
    }
  },
};
