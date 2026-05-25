import { MangaSource } from "./types";
import { mangadexSource } from "./mangadex";
import { comickSource } from "./comick";
import { mangaplusSource } from "./mangaplus";
import { naverSource } from "./naver";
import { mangafireSource } from "./mangafire";
import { asuraSource } from "./asura";

export { SourceError, SourceErrorType } from "./fetchClient";
export type { SourceFetchOptions } from "./fetchClient";

export const ALL_SOURCES: MangaSource[] = [
  mangadexSource,
  comickSource,
  mangaplusSource,
  mangafireSource,
  asuraSource,
  naverSource,
  {
    id: "kakao",
    name: "Kakao Webtoon",
    baseUrl: "https://webtoon.kakao.com",
    isEnabled: false,
    requiresVerification: true,
    async search() { return []; },
    async getTrending() { return []; },
    async getLatestUpdates() { return []; },
    async getMangaDetails(id) { return { id, title: "", coverUrl: "", sourceId: "kakao" }; },
    async getChapters() { return []; },
    async getChapterPages() { return []; },
  },
  {
    id: "bilibili",
    name: "Bilibili Comics",
    baseUrl: "https://www.bilibilicomics.com",
    isEnabled: false,
    async search() { return []; },
    async getTrending() { return []; },
    async getLatestUpdates() { return []; },
    async getMangaDetails(id) { return { id, title: "", coverUrl: "", sourceId: "bilibili" }; },
    async getChapters() { return []; },
    async getChapterPages() { return []; },
  },
  {
    id: "rawkuma",
    name: "Rawkuma",
    baseUrl: "https://rawkuma.com",
    isEnabled: false,
    requiresVerification: true,
    async search() { return []; },
    async getTrending() { return []; },
    async getLatestUpdates() { return []; },
    async getMangaDetails(id) { return { id, title: "", coverUrl: "", sourceId: "rawkuma" }; },
    async getChapters() { return []; },
    async getChapterPages() { return []; },
  },
];

export const sourceMap: Record<string, MangaSource> = Object.fromEntries(
  ALL_SOURCES.map((s) => [s.id, s]),
);

export function getSource(id: string): MangaSource {
  return sourceMap[id] ?? mangadexSource;
}

export {
  mangadexSource,
  comickSource,
  mangaplusSource,
  naverSource,
  mangafireSource,
  asuraSource,
};
export * from "./types";
