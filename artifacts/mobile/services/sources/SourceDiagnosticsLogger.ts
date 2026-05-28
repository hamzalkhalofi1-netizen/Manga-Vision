/**
 * SourceDiagnosticsLogger — Structured per-source request logger.
 *
 * Mihon equivalent: the logging output in HttpSource.kt / interceptors.
 *
 * Every log line is prefixed with [sourceId] and includes:
 *   - URL (truncated if long)
 *   - HTTP status
 *   - Timing in ms
 *   - Result count (optional)
 *   - Error type (optional)
 *
 * In development: writes to console.
 * In production: silently no-ops (process.env.NODE_ENV check).
 *
 * Usage:
 *   const log = new SourceDiagnosticsLogger("mangadex");
 *   const t = log.start();
 *   log.logRequest(url, status, resultCount, t);
 *   log.logError(url, "rate_limit", err, t);
 *   log.logCacheHit(url, t);
 */

const isDev = process.env.NODE_ENV !== "production";

function truncate(url: string, max = 120): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 3) + "...";
}

export class SourceDiagnosticsLogger {
  private readonly prefix: string;

  constructor(readonly sourceId: string) {
    this.prefix = `[${sourceId}]`;
  }

  /** Returns a start timestamp for timing. */
  start(): number {
    return Date.now();
  }

  /** Log a successful fetch: URL, status, optional result count, elapsed ms. */
  logRequest(url: string, status: number, count?: number, startedAt?: number): void {
    if (!isDev) return;
    const elapsed = startedAt != null ? ` ${Date.now() - startedAt}ms` : "";
    const countStr = count != null ? ` → ${count} result${count !== 1 ? "s" : ""}` : "";
    console.log(`${this.prefix} HTTP ${status}${elapsed}${countStr} ${truncate(url)}`);
  }

  /** Log a parse result (after JSON/HTML parsing, separate from fetch). */
  logParsed(label: string, count: number, startedAt?: number): void {
    if (!isDev) return;
    const elapsed = startedAt != null ? ` ${Date.now() - startedAt}ms` : "";
    console.log(`${this.prefix} parsed ${label}: ${count} items${elapsed}`);
  }

  /** Log an error with error type classification. */
  logError(url: string, errorType: string, err: unknown, startedAt?: number): void {
    if (!isDev) return;
    const elapsed = startedAt != null ? ` ${Date.now() - startedAt}ms` : "";
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${this.prefix} [${errorType}]${elapsed} ${truncate(url)} — ${msg}`);
  }

  /** Log a cache hit (skipped network request). */
  logCacheHit(label: string): void {
    if (!isDev) return;
    console.log(`${this.prefix} cache hit: ${label}`);
  }

  /** Generic info log. */
  log(message: string): void {
    if (!isDev) return;
    console.log(`${this.prefix} ${message}`);
  }
}
