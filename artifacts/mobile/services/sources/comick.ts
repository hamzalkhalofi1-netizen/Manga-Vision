import { Chapter, Manga, MangaSource } from "./types";
import { proxiedFetch, SourceError } from "./fetchClient";

const SITE_URL = "https://comick.io";
const API_URL = "https://api.comick.io";
// ComicK CDN for chapter images (b2key-based paths)
const CDN = "https://meo.comick.pictures";

const FETCH_OPTS = {
  sourceId: "comick",
  siteUrl: SITE_URL,
  timeoutMs: 18000,
};

function coverUrl(coverPath: string | undefined): string {
  if (!coverPath) return "";
  if (coverPath.startsWith("http")) return coverPath;
  return `${CDN}/${coverPath}`;
}

function parseComic(item: Record<string, unknown>): Manga | null {
  const mdCovers = (item.md_covers as Array<Record<string, unknown>>) ?? [];
  const firstCover = mdCovers[0];
  const cover = firstCover
    ? coverUrl((firstCover.gpurl ?? firstCover.b2key) as string | undefined)
    : "";

  const genres: string[] = [];
  const tagsRaw = (item.genres as Array<Record<string, unknown>>) ?? [];
  tagsRaw.forEach((t) => { if (t.name) genres.push(t.name as string); });

  let status: Manga["status"] = "ongoing";
  const statusNum = item.status as number | undefined;
  if (statusNum === 2) status = "completed";
  else if (statusNum === 3) status = "cancelled";
  else if (statusNum === 4) status = "hiatus";

  const id = (item.hid ?? item.slug ?? String(item.id ?? "")) as string;
  const title = (item.title ?? item.slug ?? "") as string;
  if (!id || !title) return null;

  return {
    id,
    title,
    coverUrl: cover,
    sourceId: "comick",
    status,
    rating: item.rating ? parseFloat(String(item.rating)) : undefined,
    description: (item.desc ?? item.parsed ?? "") as string,
    genres,
    year: item.year as number | undefined,
  };
}

async function comickFetch(path: string, query = ""): Promise<unknown> {
  const res = await proxiedFetch("comick-api", path, query, {
    ...FETCH_OPTS,
    siteUrl: API_URL,
    directOnWeb: true,
    headers: { Accept: "application/json" },
  });

  const ct = res.headers.get("content-type") ?? "";
  console.log(`[comick] ${path}${query} → status=${res.status} content-type=${ct}`);

  if (!ct.includes("application/json") && !ct.includes("text/json")) {
    const body = await res.text();
    const isCF = /just a moment|checking your browser|cf-ray/i.test(body);
    const isNotFound = res.status === 404 || /not.found|404/i.test(body.slice(0, 200));
    console.warn(`[comick] DIAGNOSTIC: non-JSON response. CF=${isCF} 404=${isNotFound} body[:200]="${body.slice(0, 200)}"`);

    if (isCF) {
      throw new SourceError(
        "ComicK is protected by Cloudflare. Open ComicK in a browser first, then retry.",
        "cloudflare", res.status, "comick"
      );
    }
    if (isNotFound) {
      throw new SourceError(
        `ComicK: resource not found — ${path}`,
        "not_found", res.status, "comick"
      );
    }
    throw new SourceError(
      "ComicK API is currently unavailable — try MangaDex or Asura Scans instead.",
      "upstream", res.status, "comick"
    );
  }

  const json = await res.json();

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const j = json as Record<string, unknown>;
    if (j.result === "error" || j.error) {
      throw new SourceError(
        `ComicK API error: ${j.message ?? j.error ?? "unknown error"}`,
        "upstream", res.status, "comick"
      );
    }
  }

  return json;
}

function requireArray(data: unknown, context: string): Array<Record<string, unknown>> {
  const items = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.result as unknown[]) ?? [];
  if (!Array.isArray(items) || items.length === 0) {
    console.warn(`[comick] PARSER DIAGNOSTIC: ${context} returned 0 items. data type=${typeof data} isArray=${Array.isArray(data)}`);
  } else {
    console.log(`[comick] ${context} → ${items.length} items`);
  }
  return items as Array<Record<string, unknown>>;
}

/**
 * Construct a full CDN image URL from a ComicK image object.
 * ComicK images can have:
 *   - img.url       (direct full URL)
 *   - img.b2key     (Backblaze key: "comicHid/chapterHid/page.jpg")
 *   - img.name      (filename only, needs chapter path prefix — use with CDN)
 */
function resolveComickImageUrl(img: Record<string, unknown>, chapterId?: string): string {
  // Direct URL (highest priority)
  if (typeof img.url === "string" && img.url.startsWith("http")) return img.url;

  // b2key — full CDN path (most common in API responses)
  if (typeof img.b2key === "string") {
    const key = img.b2key as string;
    return key.startsWith("http") ? key : `${CDN}/${key}`;
  }

  // name — filename only; reconstruct with chapter context if available
  if (typeof img.name === "string") {
    const name = img.name as string;
    if (name.startsWith("http")) return name;
    // If we have chapterId, we can try to construct a path
    if (chapterId) return `${CDN}/${chapterId}/${name}`;
    return `${CDN}/${name}`;
  }

  // gpurl — Google-proxied CDN URL (used in some listing responses)
  if (typeof img.gpurl === "string" && img.gpurl.startsWith("http")) return img.gpurl;

  return "";
}

async function fetchAllChapters(mangaId: string): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let page = 1;
  const limit = 300; // ComicK max per page

  while (true) {
    const qs = new URLSearchParams({
      lang: "en",
      limit: String(limit),
      page: String(page),
    }).toString();

    const data = await comickFetch(`/comic/${mangaId}/chapters`, `?${qs}`) as Record<string, unknown>;
    const chapters = (data.chapters as Array<Record<string, unknown>>) ?? [];

    if (!Array.isArray(chapters) || chapters.length === 0) {
      if (page === 1) {
        console.warn(`[comick] PARSER DIAGNOSTIC: getChapters(${mangaId}) page=${page} → 0. data keys:`, Object.keys(data).slice(0, 8));
      }
      break;
    }

    console.log(`[comick] getChapters(${mangaId}) page=${page} → ${chapters.length} chapters`);
    all.push(...chapters);

    // ComicK returns `total` in the response; stop if we have all
    const total = typeof data.total === "number" ? data.total : null;
    if (total !== null && all.length >= total) break;
    if (chapters.length < limit) break;

    page++;
  }

  return all;
}

export const comickSource: MangaSource = {
  id: "comick",
  name: "Comick",
  baseUrl: SITE_URL,
  isEnabled: true,

  async search(query: string, page = 0): Promise<Manga[]> {
    const qs = new URLSearchParams({
      q: query, limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const data = await comickFetch("/v1.0/search", `?${qs}`);
    const items = requireArray(data, `search("${query}")`);
    const results = items.map((d) => parseComic(d)).filter((m): m is Manga => m !== null);
    if (results.length === 0 && items.length > 0) {
      console.warn("[comick] PARSER DIAGNOSTIC: items present but 0 parsed. First item keys:", Object.keys(items[0] ?? {}).slice(0, 8));
    }
    return results;
  },

  async getTrending(page = 0): Promise<Manga[]> {
    const qs = new URLSearchParams({
      sort: "follow", limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const data = await comickFetch("/v1.0/search", `?${qs}`);
    const items = requireArray(data, "getTrending");
    const results = items.map((d) => parseComic(d)).filter((m): m is Manga => m !== null);
    if (results.length === 0) {
      console.warn("[comick] PARSER DIAGNOSTIC: getTrending returned 0 manga.");
    }
    return results;
  },

  async getLatestUpdates(page = 0): Promise<Manga[]> {
    const qs = new URLSearchParams({
      sort: "uploaded", limit: "20", page: String(page + 1), type: "comic",
    }).toString();
    const data = await comickFetch("/v1.0/search", `?${qs}`);
    const items = requireArray(data, "getLatestUpdates");
    const results = items.map((d) => parseComic(d)).filter((m): m is Manga => m !== null);
    if (results.length === 0) {
      console.warn("[comick] PARSER DIAGNOSTIC: getLatestUpdates returned 0 manga.");
    }
    return results;
  },

  async getMangaDetails(id: string): Promise<Manga> {
    const data = await comickFetch(`/comic/${id}`) as Record<string, unknown>;
    const comic = (data.comic ?? data) as Record<string, unknown>;
    const parsed = parseComic(comic);
    if (!parsed) {
      console.warn(`[comick] PARSER DIAGNOSTIC: getMangaDetails(${id}) failed to parse. keys:`, Object.keys(comic).slice(0, 8));
      throw new SourceError(`ComicK: could not parse manga details for ${id}`, "upstream", undefined, "comick");
    }
    return parsed;
  },

  async getChapters(mangaId: string): Promise<Chapter[]> {
    const rawChapters = await fetchAllChapters(mangaId);

    if (rawChapters.length === 0) return [];

    console.log(`[comick] getChapters(${mangaId}) total → ${rawChapters.length} chapters`);

    return rawChapters.map((c) => ({
      id: (c.hid ?? c.id) as string,
      number: String(c.chap ?? c.chapter ?? "?"),
      title: c.title as string | undefined,
      publishedAt: (c.created_at ?? c.updated_at ?? "") as string,
      pages: c.images_count as number | undefined,
      translatedLanguage: "en",
      scanlator: ((c.group_name as string[]) ?? []).join(", ") || undefined,
    })).filter((c) => c.id);
  },

  async getChapterPages(chapterId: string): Promise<string[]> {
    const data = await comickFetch(`/chapter/${chapterId}`) as Record<string, unknown>;

    // ComicK response: { chapter: { hid, images: [...] } }
    const chapterObj = (data.chapter ?? data) as Record<string, unknown>;
    const images = chapterObj.images ?? data.images ?? [];

    if (!Array.isArray(images) || images.length === 0) {
      console.warn(`[comick] PARSER DIAGNOSTIC: getChapterPages(${chapterId}) → 0 images. chapter keys:`, Object.keys(chapterObj).slice(0, 8));
      return [];
    }

    const urls = (images as Array<Record<string, unknown>>)
      .map((img) => resolveComickImageUrl(img, chapterId))
      .filter((u) => u.length > 5);

    console.log(`[comick] getChapterPages(${chapterId}) → ${urls.length} images`);
    return urls;
  },
};
