import { MangaSource } from "./types";
import { mangadexSource } from "./mangadex";
import { comickSource } from "./comick";

export const ALL_SOURCES: MangaSource[] = [
  mangadexSource,
  comickSource,
  {
    id: "mangaplus",
    name: "MANGA Plus",
    baseUrl: "https://mangaplus.shueisha.co.jp",
    isEnabled: false,
    async search() { return []; },
    async getTrending() { return []; },
    async getLatestUpdates() { return []; },
    async getMangaDetails(id) { return { id, title: "", coverUrl: "", sourceId: "mangaplus" }; },
    async getChapters() { return []; },
    async getChapterPages() { return []; },
  },
  {
    id: "webtoon",
    name: "Webtoon",
    baseUrl: "https://www.webtoons.com",
    isEnabled: false,
    async search() { return []; },
    async getTrending() { return []; },
    async getLatestUpdates() { return []; },
    async getMangaDetails(id) { return { id, title: "", coverUrl: "", sourceId: "webtoon" }; },
    async getChapters() { return []; },
    async getChapterPages() { return []; },
  },
];

export const sourceMap: Record<string, MangaSource> = Object.fromEntries(
  ALL_SOURCES.map((s) => [s.id, s])
);

export function getSource(id: string): MangaSource {
  return sourceMap[id] ?? mangadexSource;
}

export { mangadexSource, comickSource };
export * from "./types";
