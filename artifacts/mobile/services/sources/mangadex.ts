import { Platform } from "react-native";
import { Chapter, Manga, MangaSource } from "./types";
import { InFlightDedup } from "../network/InFlightDedup";
import { SourceDiagnosticsLogger } from "./SourceDiagnosticsLogger";

const BASE = "https://api.mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";
const isWeb = Platform.OS === "web";

const dedup = new InFlightDedup<Record<string, unknown>>();
const log = new SourceDiagnosticsLogger("mangadex");

function getApiProxyBase(): string {
  // Use a relative URL on web so requests always route through the artifact
  // router at port 5000 → API server at port 3000, regardless of whether
  // the browser accesses via localhost, the Replit dev domain, or a custom domain.
  return "/api/source-proxy/mangadex-api";
}

function getCdnProxyBase(): string {
  return "/api/source-proxy/mangadex-cdn";
}

function coverUrl(mangaId: string, fileName: string): string {
  if (!mangaId || !fileName) return "";
  if (isWeb) {
    return `${getCdnProxyBase()}/covers/${mangaId}/${fileName}.512.jpg`;
  }
  return `${COVERS}/${mangaId}/${fileName}.512.jpg`;
}

function safeStr(val: unknown, fallback = ""): string {
  if (typeof val === "string" && val.trim()) return val.trim();
  return fallback;
}

function parseMangaData(data: unknown): Manga {
  if (!data || typeof data !== "object") {
    return { id: "", title: "Unknown", coverUrl: "", sourceId: "mangadex" };
  }
  const item = data as Record<string, unknown>;
  const attrs = (item.attributes && typeof item.attributes === "object"
    ? item.attributes
    : {}) as Record<string, unknown>;

  const titleObj = (attrs.title && typeof attrs.title === "object"
    ? attrs.title
    : {}) as Record<string, string>;
  const title =
    safeStr(titleObj.en) ||
    safeStr(titleObj["ja-ro"]) ||
    safeStr(Object.values(titleObj)[0]) ||
    "Unknown";

  const descObj = (attrs.description && typeof attrs.description === "object"
    ? attrs.description
    : {}) as Record<string, string>;
  const description =
    safeStr(descObj.en) || safeStr(Object.values(descObj)[0]);

  const relationships = Array.isArray(item.relationships) ? item.relationships : [];
  const coverRel = relationships.find(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && (r as Record<string, unknown>).type === "cover_art"
  );
  const authorRel = relationships.find(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === "object" && (r as Record<string, unknown>).type === "author"
  );

  const coverAttrs = (coverRel?.attributes && typeof coverRel.attributes === "object"
    ? coverRel.attributes
    : {}) as Record<string, string>;
  const coverFile = safeStr(coverAttrs.fileName);

  const tags = Array.isArray(attrs.tags) ? attrs.tags : [];
  const genres = (tags as unknown[])
    .filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
    .filter((t) => {
      const ta = (t.attributes && typeof t.attributes === "object" ? t.attributes : {}) as Record<string, unknown>;
      return ta?.group === "genre";
    })
    .map((t) => {
      const ta = (t.attributes && typeof t.attributes === "object" ? t.attributes : {}) as Record<string, unknown>;
      const name = (ta.name && typeof ta.name === "object" ? ta.name : {}) as Record<string, string>;
      return safeStr(name?.en) || safeStr(Object.values(name || {})[0]);
    })
    .filter(Boolean) as string[];

  const ratingObj = (attrs.rating && typeof attrs.rating === "object"
    ? attrs.rating
    : {}) as Record<string, number>;
  const authorAttrs = (authorRel?.attributes && typeof authorRel.attributes === "object"
    ? authorRel.attributes
    : {}) as Record<string, string>;

  return {
    id: safeStr(item.id as string) || String(item.id ?? ""),
    title,
    coverUrl: coverFile ? coverUrl(safeStr(item.id as string), coverFile) : "",
    sourceId: "mangadex",
    status: safeStr(attrs.status as string) as Manga["status"] || undefined,
    rating: typeof ratingObj?.average === "number" ? ratingObj.average : undefined,
    description,
    genres,
    author: safeStr(authorAttrs.name) || undefined,
    year: typeof attrs.year === "number" ? attrs.year : undefined,
    contentRating: safeStr(attrs.contentRating as string) || undefined,
  };
}

/**
 * Fetch from the MangaDex API, routing through the server-side proxy on web.
 * Threads an external AbortSignal so the caller can cancel in-flight requests.
 */
async function apiFetch(
  path: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  // Forward external abort → internal controller
  let onAbort: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new DOMException("signal is aborted without reason", "AbortError");
    }
    onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
  }

  const t = log.start();
  const url = isWeb ? `${getApiProxyBase()}${path}` : `${BASE}${path}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    log.logRequest(url, res.status, undefined, t);
    if (!res.ok) throw new Error(`MangaDex API error: ${res.status} for ${path}`);
    const json = await res.json();
    if (json.result === "error") {
      throw new Error(`MangaDex error: ${json.errors?.[0]?.detail ?? "Unknown error"}`);
    }
    return json;
  } catch (err) {
    if (err instanceof Error && err.name !== "AbortError") {
      log.logError(url, "network", err, t);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function buildParams(base: Record<string, string>, arrays: Record<string, string[]> = {}): string {
  const p = new URLSearchParams(base);
  for (const [key, values] of Object.entries(arrays)) {
    values.forEach((v) => p.append(key, v));
  }
  return p.toString();
}

export const mangadexSource: MangaSource = {
  id: "mangadex",
  name: "MangaDex",
  baseUrl: "https://mangadex.org",
  isEnabled: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { title: query, limit: "20", offset: String(page * 20) },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const key = `search:${query}:${page}`;
    const t = log.start();
    const data = await dedup.get(key, () => apiFetch(`/manga?${qs}`));
    const results = ((data.data as unknown[]) || []).map(parseMangaData).filter((m) => m.id);
    log.logParsed("search", results.length, t);
    return results;
  },

  async getTrending(page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { limit: "20", offset: String(page * 20), "order[followedCount]": "desc" },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const key = `trending:${page}`;
    const t = log.start();
    const data = await dedup.get(key, () => apiFetch(`/manga?${qs}`));
    const results = ((data.data as unknown[]) || []).map(parseMangaData).filter((m) => m.id);
    log.logParsed("trending", results.length, t);
    return results;
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const qs = buildParams(
      { limit: "20", offset: String(page * 20), "order[latestUploadedChapter]": "desc" },
      { "includes[]": ["cover_art", "author"], "contentRating[]": ["safe", "suggestive"] }
    );
    const key = `latest:${page}`;
    const t = log.start();
    const data = await dedup.get(key, () => apiFetch(`/manga?${qs}`));
    const results = ((data.data as unknown[]) || []).map(parseMangaData).filter((m) => m.id);
    log.logParsed("latest", results.length, t);
    return results;
  },

  async getMangaDetails(id: string): Promise<Manga> {
    if (!id) throw new Error("Manga ID is required");
    const qs = buildParams(
      {},
      { "includes[]": ["cover_art", "author", "artist"] }
    );
    const key = `details:${id}`;
    const t = log.start();
    const data = await dedup.get(key, () => apiFetch(`/manga/${id}?${qs}`));
    const manga = parseMangaData(data.data);
    log.logParsed("manga-detail", 1, t);
    if (!manga.id) throw new Error("Failed to parse manga details");
    return manga;
  },

  /**
   * Fetches ALL English chapters with pagination (500 per page).
   * Loops until data.total is exhausted. Deduplicates by chapter number.
   * Respects the caller's AbortSignal — abandons remaining pages if aborted.
   */
  async getChapters(mangaId: string, signal?: AbortSignal): Promise<Chapter[]> {
    if (!mangaId) return [];

    const t = log.start();
    const allChapters: Chapter[] = [];
    const seen = new Set<string>();
    const PAGE_SIZE = 500;
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      if (signal?.aborted) break;

      const qs = buildParams(
        { limit: String(PAGE_SIZE), offset: String(offset), "order[chapter]": "desc" },
        { "translatedLanguage[]": ["en"], "includes[]": ["scanlation_group"] }
      );

      const pageKey = `chapters:${mangaId}:${offset}`;
      // Pass signal as 3rd arg (per-caller abort), NOT into the factory.
      // This lets the shared in-flight request survive if only one caller aborts.
      const data = await dedup.get(
        pageKey,
        () => apiFetch(`/manga/${mangaId}/feed?${qs}`),
        signal,
      );

      if (typeof data.total === "number") total = data.total;
      const items = Array.isArray(data.data) ? data.data : [];

      log.log(`chapters page offset=${offset} got ${items.length} / total=${total}`);

      for (const c of items) {
        if (!c || typeof c !== "object") continue;
        const item = c as Record<string, unknown>;
        const attrs = (item.attributes && typeof item.attributes === "object"
          ? item.attributes : {}) as Record<string, unknown>;
        const num = safeStr(attrs.chapter as string) || "?";
        if (seen.has(num)) continue;
        seen.add(num);

        const rels = Array.isArray(item.relationships) ? item.relationships : [];
        const groupRel = rels.find(
          (r): r is Record<string, unknown> =>
            r !== null && typeof r === "object" && (r as Record<string, unknown>).type === "scanlation_group"
        );
        const groupAttrs = (groupRel?.attributes && typeof groupRel.attributes === "object"
          ? groupRel.attributes : {}) as Record<string, string>;

        allChapters.push({
          id: safeStr(item.id as string),
          number: num,
          title: safeStr(attrs.title as string) || undefined,
          publishedAt: safeStr(attrs.publishAt as string),
          pages: typeof attrs.pages === "number" ? attrs.pages : undefined,
          translatedLanguage: safeStr(attrs.translatedLanguage as string) || undefined,
          scanlator: safeStr(groupAttrs.name) || undefined,
        });
      }

      offset += PAGE_SIZE;
      if (items.length < PAGE_SIZE) break;
    }

    log.logParsed("chapters", allChapters.length, t);
    return allChapters;
  },

  async getChapterPages(chapterId: string, signal?: AbortSignal): Promise<string[]> {
    if (!chapterId) return [];
    const key = `pages:${chapterId}`;
    const t = log.start();
    // Pass signal as 3rd arg (per-caller abort), NOT into the factory.
    const data = await dedup.get(
      key,
      () => apiFetch(`/at-home/server/${chapterId}`),
      signal,
    );
    const baseUrl = safeStr(data.baseUrl as string);
    const chapter = (data.chapter && typeof data.chapter === "object"
      ? data.chapter : {}) as Record<string, unknown>;
    const hash = safeStr(chapter.hash as string);
    const files = Array.isArray(chapter.data) ? chapter.data : [];
    if (!baseUrl || !hash) return [];
    const pages = files
      .filter((f): f is string => typeof f === "string" && f.length > 0)
      .map((file) => `${baseUrl}/data/${hash}/${file}`);
    log.logParsed("pages", pages.length, t);
    return pages;
  },
};
