/**
 * EngineHttpClient — Unified HTTP client for all source adapters.
 *
 * Handles every concern that was previously duplicated across individual
 * source files:
 *   - Proxy routing: `/api/source-proxy/{proxyId}/…` on web; direct on native
 *   - Browser headers: User-Agent, Accept-Language, Referer, Origin
 *   - Cookie injection: reads from CookieManager keyed by sourceId
 *   - Response cookie storage: parses Set-Cookie into CookieManager
 *   - Cloudflare detection: throws SourceError("cloudflare") on CF blocks
 *   - Retry with exponential backoff + jitter (via RetryHandler.withRetry)
 *   - Health tracking: records success/failure in sourceHealth
 *   - Abort signal forwarding with internal timeout
 *
 * Usage — two main methods:
 *   client.getJson<T>(path, opts?)  → parsed JSON, throws SourceError on failure
 *   client.getHtml(path, opts?)     → response text, throws SourceError on failure
 *
 * Configuration — `HttpClientConfig`:
 *   sourceId  : used for health tracking, cookie jar, and error attribution
 *   proxyId   : registry key in /api/source-proxy/:proxyId (defaults to sourceId)
 *   siteUrl   : base URL on native (and for Referer/Origin headers)
 *   timeoutMs : per-request timeout (default 20 000 ms)
 */

import { Platform } from "react-native";
import { CookieManager } from "../network/CookieManager";
import { CloudflareSession } from "../network/CloudflareSession";
import {
  withRetry,
  classifyHttpStatus,
  RetryableError,
  RetryPolicy,
} from "../network/RetryHandler";
import { sourceHealth } from "../sourceHealth";
import { SourceError, SourceErrorType } from "./errors";

export const ENGINE_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Relative path to the server-side source proxy on the API server. */
const PROXY_BASE = "/api/source-proxy";

const isWeb = Platform.OS === "web";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HttpClientConfig {
  /** Source identifier — used for health tracking, cookie jar, and errors. */
  sourceId: string;
  /**
   * Proxy registry key in source-proxy.ts.
   * Defaults to `sourceId` if omitted.
   * Use a different value when the API lives on a separate subdomain
   * (e.g. proxyId="asura-api" for api.asurascans.com while sourceId="asura").
   */
  proxyId?: string;
  /** Base URL on native (and for Referer / Origin headers). */
  siteUrl: string;
  /** Extra headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Per-request abort timeout (default 20 000 ms). */
  timeoutMs?: number;
  /** Retry policy. Defaults to 3 attempts with exponential backoff + jitter. */
  retryPolicy?: RetryPolicy;
}

export interface GetOptions {
  /** Merged with defaultHeaders. */
  headers?: Record<string, string>;
  /** AbortSignal for caller-controlled cancellation. */
  signal?: AbortSignal;
  /**
   * When true, always fetch directly even on web (for APIs with CORS headers
   * like api.mangadex.org). Defaults to false.
   */
  directOnWeb?: boolean;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class EngineHttpClient {
  private readonly cfg: Required<Pick<HttpClientConfig, "sourceId" | "siteUrl" | "timeoutMs">> &
    Pick<HttpClientConfig, "proxyId" | "defaultHeaders" | "retryPolicy">;

  constructor(config: HttpClientConfig) {
    this.cfg = {
      sourceId: config.sourceId,
      proxyId: config.proxyId,
      siteUrl: config.siteUrl.replace(/\/$/, ""),
      defaultHeaders: config.defaultHeaders ?? {},
      timeoutMs: config.timeoutMs ?? 20_000,
      retryPolicy: config.retryPolicy,
    };
  }

  // ── URL construction ────────────────────────────────────────────────────────

  private buildUrl(path: string, opts?: GetOptions): string {
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    if (!isWeb || opts?.directOnWeb) {
      return `${this.cfg.siteUrl}/${cleanPath}`;
    }
    const pid = this.cfg.proxyId ?? this.cfg.sourceId;
    return `${PROXY_BASE}/${pid}/${cleanPath}`;
  }

  // ── Header construction ─────────────────────────────────────────────────────

  private async buildHeaders(
    extra?: Record<string, string>,
  ): Promise<Record<string, string>> {
    const referer = this.cfg.siteUrl + "/";
    const cookieStr = await CookieManager.toCookieString(this.cfg.sourceId);

    const headers: Record<string, string> = {
      "User-Agent": ENGINE_BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer,
      Origin: this.cfg.siteUrl,
      // Force revalidation-free requests. Scraped HTML/JSON is volatile (signed
      // CDN URLs, chapter content) — a client-side HTTP cache that transparently
      // resolves a 304 into a stale/empty body is a silent data-loss bug, not
      // an optimization. See httpClient.ts fetch() call for the matching
      // `cache: "no-store"` on the request itself.
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...(this.cfg.defaultHeaders ?? {}),
      ...extra,
    };

    // Inject cookies on native (web proxy handles cookies server-side)
    if (cookieStr && !isWeb) {
      headers.Cookie = cookieStr;
    }

    return headers;
  }

  // ── Core GET ────────────────────────────────────────────────────────────────

  /**
   * Make a GET request and return the raw Response.
   * Handles proxy routing, cookies, retries, Cloudflare detection, and health.
   */
  async get(path: string, opts?: GetOptions): Promise<Response> {
    const { sourceId, timeoutMs } = this.cfg;
    const url = this.buildUrl(path, opts);

    // Bail out fast if source is temporarily disabled
    const health = await sourceHealth.getHealth(sourceId);
    if (sourceHealth.isDisabled(health)) {
      const remaining = Math.ceil(sourceHealth.getDisabledRemaining(health) / 60_000);
      throw new SourceError(
        `${sourceId} is temporarily unavailable (${remaining}m remaining). ` +
          (health.lastErrorType === "cloudflare"
            ? "Browser verification required."
            : "Too many failures."),
        (health.lastErrorType as SourceErrorType) ?? "upstream",
        undefined,
        sourceId,
      );
    }

    const policy: RetryPolicy = this.cfg.retryPolicy ?? {
      maxAttempts: 3,
      baseDelayMs: 1_200,
      maxDelayMs: 20_000,
      backoffFactor: 2,
      jitter: true,
    };

    return withRetry(
      async (attempt) => {
        if (attempt > 1) {
          console.log(`[engine:${sourceId}] retry attempt ${attempt} for ${path}`);
        }

        const headers = await this.buildHeaders(opts?.headers);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        // Forward external abort signal into our internal controller
        let forwardAbort: (() => void) | undefined;
        if (opts?.signal) {
          if (opts.signal.aborted) {
            clearTimeout(timer);
            throw new DOMException("signal is aborted without reason", "AbortError");
          }
          forwardAbort = () => controller.abort();
          opts.signal.addEventListener("abort", forwardAbort, { once: true });
        }

        let res: Response;
        try {
          res = await fetch(url, {
            headers,
            signal: controller.signal,
            // Bypass the platform HTTP cache entirely. Without this, a
            // revisited chapter/page URL can be served as a bare 304 with an
            // EMPTY body by an intermediate cache (browser disk cache, RN
            // networking layer, or the proxy's own conditional-GET handling)
            // — which silently zeroes out image/page extraction downstream.
            cache: "no-store",
          });
        } finally {
          clearTimeout(timer);
          if (opts?.signal && forwardAbort) {
            opts.signal.removeEventListener("abort", forwardAbort);
          }
        }

        // Persist cookies from Set-Cookie headers
        await CookieManager.storeFromHeaders(sourceId, res.headers);

        // Cloudflare challenge / anti-bot block
        if (res.status === 403 || res.status === 503) {
          const snippet = await res.clone().text().catch(() => "");
          const errType = classifyHttpStatus(res.status, snippet);
          if (errType === "cloudflare") {
            await CloudflareSession.invalidate(sourceId);
            await sourceHealth.recordFailure(sourceId, "cloudflare");
            throw new SourceError(
              `Cloudflare protection on ${sourceId}. Please verify the source.`,
              "cloudflare",
              res.status,
              sourceId,
            );
          }
        }

        if (res.status === 429) {
          await sourceHealth.recordFailure(sourceId, "rate_limit");
          throw new RetryableError(`Rate limited by ${sourceId}`, "rate_limit", 429);
        }

        if (!res.ok) {
          const errType = classifyHttpStatus(res.status) as SourceErrorType;
          // Don't retry 404 / 401 / 403
          if ([404, 401, 403].includes(res.status)) {
            await sourceHealth.recordFailure(sourceId, errType);
            throw new SourceError(
              `HTTP ${res.status} from ${sourceId}`,
              errType,
              res.status,
              sourceId,
            );
          }
          // Retryable upstream errors (5xx, etc.)
          throw new RetryableError(`HTTP ${res.status}`, errType, res.status);
        }

        await sourceHealth.recordSuccess(sourceId);
        return res;
      },
      policy,
      opts?.signal,
    );
  }

  // ── Typed accessors ─────────────────────────────────────────────────────────

  /**
   * GET and parse body as JSON.
   * Throws SourceError("parse") if the response is not valid JSON.
   */
  async getJson<T>(path: string, opts?: GetOptions): Promise<T> {
    const res = await this.get(path, {
      ...opts,
      headers: {
        Accept: "application/json, text/plain, */*",
        ...opts?.headers,
      },
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SourceError(
        `Invalid JSON from ${this.cfg.sourceId}: ${path}`,
        "parse",
        res.status,
        this.cfg.sourceId,
      );
    }
  }

  /**
   * GET and return the body as a plain string (HTML / text).
   */
  async getHtml(path: string, opts?: GetOptions): Promise<string> {
    const res = await this.get(path, {
      ...opts,
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        ...opts?.headers,
      },
    });
    return res.text();
  }
}
