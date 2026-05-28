/**
 * InFlightDedup — In-flight request deduplication with per-caller abort support.
 *
 * Mihon equivalent: RateLimitInterceptor / request coalescing in HttpSource.kt.
 *
 * If an identical key is already in-flight, returns the same Promise instead of
 * launching a new request. Cleans up automatically on resolve or reject.
 *
 * CRITICAL DESIGN: The abort signal is handled PER-CALLER, not in the factory.
 * This means one caller aborting their wait does NOT cancel the underlying shared
 * request — other callers continue receiving the result normally.
 *
 * Usage:
 *   const dedup = new InFlightDedup<Manga[]>();
 *   // Without abort — shared promise, all callers get the result:
 *   const data = await dedup.get("manga:abc", () => fetchManga("abc"));
 *   // With abort — this caller can cancel their wait without killing others:
 *   const data = await dedup.get("manga:abc", () => fetchManga("abc"), signal);
 */
export class InFlightDedup<T> {
  private readonly inflight = new Map<string, Promise<T>>();

  /**
   * If `key` is already in-flight, returns a promise that resolves/rejects with
   * the shared result. Otherwise calls `factory()`, stores the shared Promise,
   * and returns it. The shared entry is removed once the Promise settles.
   *
   * When `signal` is provided, this caller's await is wrapped so that if the
   * signal fires, THIS caller's promise rejects with an AbortError immediately —
   * but the underlying shared network request continues for any other waiters.
   */
  get(key: string, factory: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    // Short-circuit if already aborted before even starting
    if (signal?.aborted) {
      return Promise.reject(
        new DOMException("signal is aborted without reason", "AbortError"),
      );
    }

    // Get or create the shared underlying request
    let shared = this.inflight.get(key);
    if (!shared) {
      shared = factory().finally(() => {
        this.inflight.delete(key);
      });
      this.inflight.set(key, shared);
    }

    // No signal — return shared promise directly (fastest path)
    if (!signal) return shared;

    // Per-caller abort wrapper: this caller's signal fires → they get AbortError.
    // The shared request is NOT cancelled; other waiters are unaffected.
    return new Promise<T>((resolve, reject) => {
      // Re-check after synchronous setup (signal could have fired between the
      // check at the top of `get` and the Promise constructor running).
      if (signal.aborted) {
        reject(new DOMException("signal is aborted without reason", "AbortError"));
        return;
      }

      const onAbort = () => {
        reject(new DOMException("signal is aborted without reason", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      shared!.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (err: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
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
