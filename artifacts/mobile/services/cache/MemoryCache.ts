/**
 * MemoryCache — Generic LRU (Least Recently Used) in-memory cache.
 *
 * Architecture inspired by Mihon's in-memory image cache layer.
 * Evicts the least-recently-used entry when the cache exceeds its
 * configured capacity (by entry count or by total byte size).
 *
 * Usage:
 *   const cache = new MemoryCache<string>({ maxEntries: 20, maxBytes: 50 * 1024 * 1024 });
 *   cache.set("key", "value", 1024);
 *   cache.get("key"); // "value" — also marks it as recently used
 */

export interface MemoryCacheOptions {
  /** Maximum number of cached entries (default: 30) */
  maxEntries?: number;
  /** Maximum total bytes across all entries (default: 50 MB) */
  maxBytes?: number;
}

interface CacheEntry<T> {
  value: T;
  sizeBytes: number;
  lastAccessed: number;
}

export class MemoryCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(opts: MemoryCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 30;
    this.maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    // Update LRU timestamp
    entry.lastAccessed = Date.now();
    // Move to end of Map insertion order (most-recently-used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, sizeBytes = 0): void {
    // Remove existing entry for this key (size accounting)
    const existing = this.map.get(key);
    if (existing) {
      this.totalBytes -= existing.sizeBytes;
      this.map.delete(key);
    }

    const entry: CacheEntry<T> = { value, sizeBytes, lastAccessed: Date.now() };
    this.map.set(key, entry);
    this.totalBytes += sizeBytes;

    this.evict();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.totalBytes -= entry.sizeBytes;
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }

  private evict(): void {
    // Evict LRU entries while over limits.
    // Map insertion order = LRU order (oldest first).
    while (
      (this.map.size > this.maxEntries || this.totalBytes > this.maxBytes) &&
      this.map.size > 0
    ) {
      const firstKey = this.map.keys().next().value as string;
      const entry = this.map.get(firstKey)!;
      this.totalBytes -= entry.sizeBytes;
      this.map.delete(firstKey);
    }
  }
}
