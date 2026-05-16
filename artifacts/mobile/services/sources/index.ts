import { MangaSource } from "./types";
import { mangadexSource } from "./mangadex";
import { comickSource } from "./comick";
import { mangaplusSource } from "./mangaplus";
import { naverSource } from "./naver";

function stub(id: string, name: string, baseUrl: string): MangaSource {
  return {
    id,
    name,
    baseUrl,
    isEnabled: false,
    async search() { return []; },
    async getTrending() { return []; },
    async getLatestUpdates() { return []; },
    async getMangaDetails(mangaId) { return { id: mangaId, title: "", coverUrl: "", sourceId: id }; },
    async getChapters() { return []; },
    async getChapterPages() { return []; },
  };
}

export const ALL_SOURCES: MangaSource[] = [
  mangadexSource,
  comickSource,
  mangaplusSource,
  naverSource,
  stub("mangafire", "MangaFire", "https://mangafire.to"),
  stub("asura", "Asura Scans", "https://asuracomic.net"),
  stub("kakao", "Kakao Webtoon", "https://webtoon.kakao.com"),
  stub("bilibili", "Bilibili Comics", "https://www.bilibilicomics.com"),
  stub("rawkuma", "Rawkuma", "https://rawkuma.com"),
];

export const sourceMap: Record<string, MangaSource> = Object.fromEntries(
  ALL_SOURCES.map((s) => [s.id, s])
);

export function getSource(id: string): MangaSource {
  return sourceMap[id] ?? mangadexSource;
}

export { mangadexSource, comickSource, mangaplusSource, naverSource };
export * from "./types";
