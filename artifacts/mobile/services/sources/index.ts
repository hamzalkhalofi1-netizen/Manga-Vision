import { MangaSource } from "./types";
import { mangadexSource } from "./mangadex";
import { comickSource } from "./comick";
import { mangaplusSource } from "./mangaplus";
import { naverSource } from "./naver";
import { mangafireSource } from "./mangafire";
import { asuraSource } from "./asura/index";
import { batoSource } from "./bato";
import { kakalotSource } from "./kakalot";
import { manganeloSource } from "./manganelo";
import { manganatoSource } from "./manganato";
import { SourceRegistry } from "./SourceRegistry";

export { SourceError, SourceErrorType } from "./fetchClient";
export type { SourceFetchOptions } from "./fetchClient";
export { SourceRegistry } from "./SourceRegistry";
export type { SourceMetadata, RegisteredSource } from "./SourceRegistry";
export { BaseSource } from "./BaseSource";

// ── Register all sources with metadata ────────────────────────────────────

SourceRegistry.registerAll([
  {
    source: mangadexSource,
    meta: {
      language: "en",
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      hasOfficialApi: true,
      tags: ["official-api", "multi-language"],
      websiteUrl: "https://mangadex.org",
    },
  },
  {
    source: comickSource,
    meta: {
      language: ["en", "multi"],
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      hasOfficialApi: true,
      tags: ["api", "aggregator"],
      websiteUrl: "https://comick.io",
    },
  },
  {
    source: mangaplusSource,
    meta: {
      language: "en",
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      hasOfficialApi: true,
      tags: ["official", "shueisha"],
      websiteUrl: "https://mangaplus.shueisha.co.jp",
    },
  },
  {
    source: mangafireSource,
    meta: {
      language: "en",
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      hasOfficialApi: true,
      tags: ["api", "aggregator"],
      websiteUrl: "https://mangafire.to",
    },
  },
  {
    source: asuraSource,
    meta: {
      language: "en",
      nsfw: false,
      // The new adapter uses the REST API + SSR HTML — no WebView / CF challenge needed.
      requiresVerification: false,
      isEnabled: true,
      tags: ["api", "manhwa"],
      websiteUrl: "https://asurascans.com",
    },
  },
  {
    source: batoSource,
    meta: {
      language: ["en", "multi"],
      nsfw: false,
      requiresVerification: true,
      isEnabled: true,
      tags: ["scraper", "cloudflare", "community"],
      websiteUrl: "https://bato.to",
    },
  },
  {
    source: kakalotSource,
    meta: {
      language: "en",
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      tags: ["scraper", "kakalot-family"],
      websiteUrl: "https://chapmanganato.to",
    },
  },
  {
    source: manganeloSource,
    meta: {
      language: "en",
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      tags: ["scraper", "kakalot-family"],
      websiteUrl: "https://readmanganelo.com",
    },
  },
  {
    source: manganatoSource,
    meta: {
      language: "en",
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      tags: ["scraper", "kakalot-family"],
      websiteUrl: "https://chapmanganato.to",
    },
  },
  {
    source: naverSource,
    meta: {
      language: ["en", "ko"],
      nsfw: false,
      requiresVerification: false,
      isEnabled: true,
      tags: ["webtoon", "official"],
      websiteUrl: "https://www.webtoons.com",
    },
  },
  // Stub sources (not yet fully implemented)
  {
    source: {
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
    } as MangaSource,
    meta: {
      language: "ko",
      nsfw: false,
      requiresVerification: true,
      isEnabled: false,
      tags: ["webtoon", "official", "korean"],
      websiteUrl: "https://webtoon.kakao.com",
    },
  },
  {
    source: {
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
    } as MangaSource,
    meta: {
      language: ["en", "zh"],
      nsfw: false,
      requiresVerification: false,
      isEnabled: false,
      tags: ["official", "chinese"],
      websiteUrl: "https://www.bilibilicomics.com",
    },
  },
  {
    source: {
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
    } as MangaSource,
    meta: {
      language: "ja",
      nsfw: false,
      requiresVerification: true,
      isEnabled: false,
      tags: ["scraper", "cloudflare", "raw", "japanese"],
      websiteUrl: "https://rawkuma.com",
    },
  },
]);

// ── Legacy exports (backward compat) ──────────────────────────────────────

export const ALL_SOURCES: MangaSource[] = SourceRegistry.getAll();

export const sourceMap: Record<string, MangaSource> = Object.fromEntries(
  SourceRegistry.getIds().map((id) => [id, SourceRegistry.get(id)!]),
);

export function getSource(id: string): MangaSource {
  return SourceRegistry.get(id) ?? mangadexSource;
}

export {
  mangadexSource,
  comickSource,
  mangaplusSource,
  naverSource,
  mangafireSource,
  asuraSource,
  batoSource,
  kakalotSource,
  manganeloSource,
  manganatoSource,
};
export * from "./types";
