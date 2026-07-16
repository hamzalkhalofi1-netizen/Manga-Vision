/**
 * Asura Scans — REST API response types.
 *
 * Reverse-engineered from the live api.asurascans.com REST API.
 * These types cover every field the AsuraAdapter actually uses.
 * Unknown fields are left untyped (TypeScript structural subtyping
 * means extra fields are safe to ignore).
 */

// ── Genre ──────────────────────────────────────────────────────────────────

export interface AsuraGenre {
  id: number;
  name: string;
  slug: string;
}

// ── Series (appears in listings, search, and detail) ───────────────────────

export interface AsuraSeries {
  id: number;
  slug: string;
  title: string;
  alt_titles?: string[];
  alternative_titles?: string;   // plain-text pipe-separated string in detail response
  description?: string;           // may contain HTML tags
  /** Full-size cover URL (in listing response). */
  cover?: string;
  /** Cover URL key used in recommended_series sub-arrays. */
  cover_url?: string;
  banner?: string;
  status: "ongoing" | "completed" | "hiatus" | "dropped" | "cancelled" | string;
  type: string;                   // "manhwa", "manga", "manhua", …
  author?: string;
  artist?: string;
  rating?: number;
  popularity_rank?: number;
  bookmark_count?: number;
  chapter_count?: number;
  last_chapter_at?: string;
  is_pinned?: boolean;
  pdf_available?: boolean;
  public_url: string;             // "/comics/{slug}-a80d257e"
  source_url?: string;            // "/s/{id}"
  genres?: AsuraGenre[];
  /** Newest chapters (present only in listing responses). */
  latest_chapters?: AsuraChapterRef[];
  created_at?: string;
  updated_at?: string;
}

/** Minimal chapter reference embedded inside series listing entries. */
export interface AsuraChapterRef {
  id: number;
  series_id: number;
  number: number;
  slug: string;
  page_count?: number;
  is_premium?: boolean;
  published_at?: string;
  view_count?: number;
}

// ── Series list endpoint — GET /api/series ─────────────────────────────────

export interface AsuraSeriesListResponse {
  data: AsuraSeries[];
  /** Pagination metadata (may be absent on some pages). */
  meta?: {
    current_page?: number;
    last_page?: number;
    per_page?: number;
    total?: number;
  };
}

// ── Series detail endpoint — GET /api/series/{slug} ───────────────────────

export interface AsuraSeriesDetailResponse {
  series: AsuraSeries;
  recommended_series: AsuraSeries[];
}

// ── Search endpoint — GET /api/search?q={query} ───────────────────────────

export interface AsuraSearchResponse {
  data: AsuraSeries[];
}

// ── Chapter list endpoint — GET /api/series/{slug}/chapters ───────────────

export interface AsuraChapter {
  id: number;
  series_id: number;
  number: number;
  /** Either "chapter-{n}" (older) or a UUID string (newer). */
  slug: string;
  title?: string;
  page_count: number;
  is_premium: boolean;
  is_locked?: boolean;
  comments_enabled?: boolean;
  published_at: string;
  view_count?: number;
  series_slug?: string;
}

export interface AsuraChapterListResponse {
  data: AsuraChapter[];
}
