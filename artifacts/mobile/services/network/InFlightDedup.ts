/**
 * InFlightDedup — In-flight request deduplication.
 *
 * Mihon equivalent: RateLimitInterceptor / request coalescing in HttpSource.kt.
 *
 * If an identical key is already in-flight, returns the same Promise instead of
 * launching a new request. Cleans up automatically on resolve or reject.
 *
 * Usage:
 *   const dedup = new InFlightDedup<Manga[]>();
 *   const data = await dedup.get("manga:abc123", () => fetchManga("abc123"));
 */
export class InFlightDedup<T> {
  private readonly inflight = new Map<string, Promise<T>>();

  /**
   * If `key` is already in-flight, returns the existing Promise.
   * Otherwise calls `factory()`, stores the Promise, and returns it.
   * The entry is removed from the map once the Promise settles.
   */
  get(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = factory().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Number of in-flight requests. */
  get size(): number {
    return this.inflight.size;
  }

  /** Clear all tracked in-flight promises (does NOT cancel the underlying requests). */
  clear(): void {
    this.inflight.clear();
  }
}
