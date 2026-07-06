import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";

const SITE_URL = "https://mangafire.to";

// ── MangaFire JSON API ─────────────────────────────────────────────────────
// MangaFire's frontend (a Vite/SPA bundle served from s.mfcdn.nl) is fully
// client-rendered — plain HTML fetches of /filter, /manga/{id}, etc. return
// only an empty app shell with no manga data embedded server-side.
//
// The SPA itself talks to a first-party JSON REST API mounted at
// `${SITE_URL}/api/*` (axios instance with baseURL:"/api",
// Accept: application/json, X-Requested-With: XMLHttpRequest). That API is
// NOT behind Cloudflare's JS challenge (verified via direct requests with no
// cookies) and returns clean JSON, so we use it directly instead of
// scraping HTML or requiring a WebView.
//
// Known endpoints (reverse-engineered from the production JS bundle):
//   GET /api/titles?sort=...&page=...&keyword=...   → { items: [...] }  (listing/search)
//   GET /api/top-titles                              → { items: [...] }  (curated trending)
//   GET /api/titles/{hid}                            → { data: {...} }   (manga details)
//   GET /api/titles/{hid}/chapters?lang=en           → { items: [...] }  (chapter list)
//   GET /api/chapters/{chapterId}                    → { data: {...} }   (chapter + pages)
//
// `hid` is MangaFire's short opaque manga identifier (e.g. "dkw" for
// One Piece) — used as our internal manga id. Chapter identifiers are
// MangaFire's numeric chapter row ids, used directly as our chapter id.

const API_OPTS = {
  sourceId: "mangafire",
  siteUrl: SITE_URL,
  timeoutMs: 18000,
  headers: {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    Referer: SITE_URL + "/",
  },
};

function isCloudflarePage(html: string): boolean {
  return /just a moment|checking your browser|cf-browser-verification|challenge-form|attention required/i.test(html);
}

/**
 * Fetch a MangaFire `/api/*` JSON endpoint through the shared proxy/session
 * layer (proxied on web for CORS, direct on native).
 */
async function mfApiFetch<T>(path: string, query = ""): Promise<T> {
  const res = await proxiedFetch("mangafire", `/api${path}`, query, API_OPTS);
  const text = await res.text();

  if (isCloudflarePage(text)) {
    throw new SourceError(
      "MangaFire API blocked by Cloudflare verification.",
      "cloudflare",
      res.status,
      "mangafire",
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError(
      `MangaFire: invalid JSON from /api${path}`,
      "upstream",
      res.status,
      "mangafire",
    );
  }
}

// ── Response shape types ───────────────────────────────────────────────────

interface MfPoster {
  small?: string;
  medium?: string;
  large?: string;
}

interface MfTitleListItem {
  id: number;
  hid: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  poster?: MfPoster;
  latestChapter?: number;
  year?: number;
  rank?: number;
  chapterUpdatedAt?: string;
  url?: string;
}

interface MfTitleListResponse {
  items: MfTitleListItem[];
}

interface MfTaxonomy {
  id: number;
  title: string;
}

interface MfTitleDetail extends MfTitleListItem {
  synopsisHtml?: string;
  altTitles?: string[];
  rating?: number;
  ratingCount?: number;
  chapterTotal?: number;
  follows?: number;
  viewsTotal?: number;
  languages?: string[];
  genres?: MfTaxonomy[];
  themes?: MfTaxonomy[];
  demographics?: MfTaxonomy[];
  authors?: MfTaxonomy[];
}

interface MfTitleDetailResponse {
  data: MfTitleDetail;
}

interface MfChapterListItem {
  id: number;
  number: number | string;
  name?: string;
  language: string;
  type?: string;
  createdAt?: number;
}

interface MfChapterListResponse {
  items: MfChapterListItem[];
}

interface MfChapterPage {
  url: string;
  width?: number;
  height?: number;
}

interface MfChapterDetail {
  id: number;
  number: number | string;
  name?: string;
  language: string;
  pages: MfChapterPage[];
}

interface MfChapterDetailResponse {
  data: MfChapterDetail;
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

const MF_STATUS_MAP: Record<string, Manga["status"]> = {
  releasing: "ongoing",
  ongoing: "ongoing",
  finished: "completed",
  completed: "completed",
  hiatus: "hiatus",
  cancelled: "cancelled",
  discontinued: "cancelled",
};

function bestCover(poster?: MfPoster): string {
  return poster?.large ?? poster?.medium ?? poster?.small ?? "";
}

function mapListItem(item: MfTitleListItem): Manga {
  return {
    id: item.hid,
    title: item.title,
    coverUrl: bestCover(item.poster),
    sourceId: "mangafire",
    status: item.status ? MF_STATUS_MAP[item.status.toLowerCase()] : undefined,
    year: item.year,
    chaptersCount: item.latestChapter,
  };
}

function mapDetail(item: MfTitleDetail): Manga {
  return {
    id: item.hid,
    title: item.title,
    coverUrl: bestCover(item.poster),
    sourceId: "mangafire",
    status: item.status ? MF_STATUS_MAP[item.status.toLowerCase()] : undefined,
    rating: typeof item.rating === "number" ? item.rating : undefined,
    description: item.synopsisHtml
      ? item.synopsisHtml.replace(/<[^>]*>/g, "").trim()
      : undefined,
    genres: (item.genres ?? []).map((g) => g.title),
    author: (item.authors ?? []).map((a) => a.title).join(", ") || undefined,
    altTitles: item.altTitles,
    year: item.year,
    chaptersCount: item.chapterTotal || item.latestChapter,
  };
}

function mapChapter(item: MfChapterListItem): Chapter {
  return {
    id: String(item.id),
    number: String(item.number),
    title: item.name && item.name.trim() ? item.name.trim() : undefined,
    publishedAt: item.createdAt ? new Date(item.createdAt * 1000).toISOString() : "",
    translatedLanguage: item.language,
  };
}

// ── Source implementation ───────────────────────────────────────────────────

export const mangafireSource: MangaSource = {
  id: "mangafire",
  name: "MangaFire",
  baseUrl: SITE_URL,
  isEnabled: true,
  requiresVerification: false,

  async getTrending(page = 0): Promise<Manga[]> {
    try {
      if (page === 0) {
        const json = await mfApiFetch<MfTitleListResponse>("/top-titles");
        const items = json.items ?? [];
        if (items.length > 0) return items.map(mapListItem);
      }
      const json = await mfApiFetch<MfTitleListResponse>(
        "/titles",
        `?sort=${encodeURIComponent("rank")}&page=${page + 1}`,
      );
      return (json.items ?? []).map(mapListItem);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    try {
      const json = await mfApiFetch<MfTitleListResponse>(
        "/titles",
        `?sort=${encodeURIComponent("chapter_updated_at:desc")}&page=${page + 1}`,
      );
      return (json.items ?? []).map(mapListItem);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async search(query: string, page = 0): Promise<Manga[]> {
    try {
      const qs = `?keyword=${encodeURIComponent(query)}&sort=${encodeURIComponent("relevance:desc")}&page=${page + 1}`;
      const json = await mfApiFetch<MfTitleListResponse>("/titles", qs);
      return (json.items ?? []).map(mapListItem);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError("MangaFire search failed.", "network", undefined, "mangafire");
    }
  },

  async getMangaDetails(id: string): Promise<Manga> {
    try {
      const json = await mfApiFetch<MfTitleDetailResponse>(`/titles/${encodeURIComponent(id)}`);
      return mapDetail(json.data);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return { id, title: id, coverUrl: "", sourceId: "mangafire" };
    }
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    try {
      const json = await mfApiFetch<MfChapterListResponse>(
        `/titles/${encodeURIComponent(mangaId)}/chapters`,
        "?lang=en",
      );
      let items = json.items ?? [];
      // Some titles only have chapters in non-English languages; fall back
      // to the unfiltered list rather than showing nothing.
      if (items.length === 0) {
        const all = await mfApiFetch<MfChapterListResponse>(
          `/titles/${encodeURIComponent(mangaId)}/chapters`,
        );
        items = all.items ?? [];
      }
      return items.map(mapChapter);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    try {
      const json = await mfApiFetch<MfChapterDetailResponse>(`/chapters/${encodeURIComponent(chapterId)}`);
      const pages = json.data?.pages ?? [];
      return pages.map((p) => p.url).filter((u): u is string => !!u);
    } catch (err) {
      if (err instanceof SourceError) throw err;
      return [];
    }
  },
};
