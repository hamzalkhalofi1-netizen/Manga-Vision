/**
 * Comick API — Response types
 *
 * Reverse-engineered from api.comick.fun.
 * Only fields the ComickAdapter actually uses are typed.
 * Unknown fields are safely ignored (TypeScript structural subtyping).
 */

// ── Cover ──────────────────────────────────────────────────────────────────

/** Thumbnail metadata attached to a comic listing entry. */
export interface ComickCover {
  vol?: string | null;
  w?: number;
  h?: number;
  /** Backblaze B2 CDN path, e.g. "KuBfSMeXNbT.jpg". Most common. */
  b2key?: string;
  /** Google-proxied CDN URL. May be empty string — check before using. */
  gpurl?: string;
}

// ── Genre ──────────────────────────────────────────────────────────────────

export interface ComickGenre {
  name: string;
  id?: number;
  slug?: string;
}

// ── Comic (appears in search/listing and nested inside detail) ─────────────

export interface ComickComic {
  /** Stable hash ID — used as the manga ID for all API calls. */
  hid: string;
  /** URL slug — fallback identifier if hid absent. */
  slug?: string;
  title: string;
  /**
   * Status numeric code:
   *   1 = ongoing, 2 = completed, 3 = cancelled, 4 = hiatus
   */
  status?: number;
  year?: number;
  /** Rating string, e.g. "8.53" */
  rating?: string;
  /** Raw description (may contain HTML). Present in detail response. */
  desc?: string;
  /** HTML-stripped description. Alternative to desc. */
  parsed?: string;
  md_covers?: ComickCover[];
  /** Genres nested inside comic object (listing responses). Often empty on detail. */
  genres?: ComickGenre[];
  last_chapter?: number;
  chapter_count?: number;
  user_follow_count?: number;
}

// ── Search / listing response ──────────────────────────────────────────────

/** /v1.0/search → array of comics directly */
export type ComickSearchResponse = ComickComic[];

// ── Manga detail response ──────────────────────────────────────────────────

/**
 * /comic/{hid} → { comic, genres, authors, artists, ... }
 *
 * NOTE: genres are at the TOP level of this response, NOT inside comic.genres.
 * Always use data.genres over data.comic.genres for correct genre data.
 */
export interface ComickDetailResponse {
  comic: ComickComic;
  /** Top-level genres — use these, not comic.genres. */
  genres?: ComickGenre[];
  authors?: Array<{ name: string; slug?: string }>;
  artists?: Array<{ name: string; slug?: string }>;
}

// ── Chapter list response ──────────────────────────────────────────────────

/** /comic/{hid}/chapters → { chapters, total } */
export interface ComickChaptersResponse {
  chapters: ComickChapter[];
  /** Declared total chapter count — used to drive pagination. */
  total?: number;
}

export interface ComickChapter {
  /** Chapter hash ID — used as the chapter ID for getChapterPages. */
  hid: string;
  id?: number;
  /** Chapter number as a string (e.g. "1", "12.5"). */
  chap?: string;
  /** Alternative field name for chapter number. */
  chapter?: string;
  vol?: string | null;
  title?: string | null;
  lang?: string;
  /** Number of images in this chapter. */
  images_count?: number;
  created_at?: string;
  updated_at?: string;
  /** Scanlation group name(s). */
  group_name?: string[];
  md_groups?: Array<{ title?: string; name?: string }>;
}

// ── Chapter detail response ────────────────────────────────────────────────

/** /chapter/{hid} → { chapter: { images: [...] }, ... } */
export interface ComickChapterResponse {
  chapter?: {
    hid: string;
    images: ComickImage[];
    [key: string]: unknown;
  };
  /** Images may also appear at the response top level. */
  images?: ComickImage[];
}

export interface ComickImage {
  /**
   * Backblaze B2 CDN path (most common, most stable).
   * e.g. "T5i4OOYG2q/0001.jpg" — prepend CDN base.
   */
  b2key?: string;
  /** Google-proxied CDN full URL. */
  gpurl?: string;
  /** Direct full URL. */
  url?: string;
  /** Filename only. Reconstructed as CDN/{chapterId}/{name} if no other field. */
  name?: string;
  w?: number;
  h?: number;
}
