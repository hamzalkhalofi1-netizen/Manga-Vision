/**
 * EngineMemoryCache — LRU in-memory cache for source API responses.
 *
 * Prevents hammering upstream APIs when the user navigates back and
 * forth between screens. Each adapter gets its own typed cache instance.
 *
 * Eviction: when maxEntries is exceeded the oldest entry (insertion
 * order) is removed. TTL expiry is checked on every read.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class EngineMemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly maxEntries: number = 100,
    private readonly defaultTtlMs: number = 60_000,
  ) {}

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // Refresh position in insertion-order map (LRU touch)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs) });
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
