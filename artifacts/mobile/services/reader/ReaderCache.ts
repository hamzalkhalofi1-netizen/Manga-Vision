/**
 * ReaderCache — In-memory LRU cache for reader page URIs.
 *
 * Mihon equivalent: The in-memory layer of ChapterCache that tracks
 * which pages are currently decoded and ready in memory.
 *
 * This cache acts as a lightweight "is this page ready?" registry.
 * The actual image bytes are owned by expo-image's internal cache;
 * ReaderCache tracks URIs so ReaderPreloader can skip re-fetching.
 *
 * Separate from the translation cache (translationQueue.ts) and the
 * generic DiskCache — this is a session-scoped, read-speed-optimised
 * layer for the active reading session.
 *
 * Capacity: 20 page URIs (one chapter ~= 20-40 pages).
 * Eviction: LRU — oldest-accessed entry dropped on overflow.
 */

import { MemoryCache } from "../cache/MemoryCache";

/** The reader cache singleton. Max 20 entries, no byte tracking needed (URIs are tiny). */
const cache = new MemoryCache<string>({ maxEntries: 20 });

export const ReaderCache = {
  /**
   * Check if a page URI is cached (i.e., prefetched and ready).
   * Marks the entry as recently used.
   */
  get(uri: string): string | undefined {
    return cache.get(uri);
  },

  /**
   * Mark a page URI as ready.
   * Value is the URI itself (or a transformed local URI on some platforms).
   */
  set(uri: string, resolvedUri: string): void {
    cache.set(uri, resolvedUri);
  },

  /**
   * Remove a page from the cache (e.g., when chapter changes).
   */
  evict(uri: string): void {
    cache.delete(uri);
  },

  /**
   * Clear all cached pages. Call when leaving the reader or changing chapters.
   */
  clear(): void {
    cache.clear();
  },

  /**
   * Number of pages currently in cache.
   */
  get size(): number {
    return cache.size;
  },
};
