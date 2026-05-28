/**
 * BaseSource — Abstract base class for all manga source adapters.
 *
 * Mihon equivalent: HttpSource.kt — provides shared fetch utilities,
 * HTML parsing helpers, date parsing, entity decoding, Cloudflare
 * detection, and a consistent interface that all source adapters extend.
 *
 * Sources that implement this class gain:
 *   - Shared browser User-Agent / Referer headers
 *   - Retry-aware fetch (via RetryHandler)
 *   - Cookie-aware headers (via CookieManager)
 *   - Cloudflare detection helpers
 *   - Common HTML parsing utilities
 *   - Standard date parsing
 *   - Manga status normalization
 */

import { Platform } from "react-native";
import { MangaSource, Manga, Chapter, MangaStatus } from "./types";
import { CookieManager } from "../network/CookieManager";
import { CloudflareSession } from "../network/CloudflareSession";
import { withRetry, classifyHttpStatus, RetryableError, RetryPolicy } from "../network/RetryHandler";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1200,
  maxDelayMs: 20000,
  backoffFactor: 2,
  jitter: true,
};

/**
 * Abstract base for HTTP manga sources.
 * Subclasses must implement the core MangaSource interface methods.
 */
export abstract class BaseSource implements MangaSource {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  abstract readonly isEnabled: boolean;
  readonly requiresVerification?: boolean;

  /** Language code(s) this source serves (e.g. "en", "ja", "ko") */
  abstract readonly language: string;

  // ── Abstract data methods ─────────────────────────────────────────────────
  abstract search(query: string, page?: number): Promise<Manga[]>;
  abstract getTrending(page?: number): Promise<Manga[]>;
  abstract getLatestUpdates(page?: number): Promise<Manga[]>;
  abstract getMangaDetails(id: string): Promise<Manga>;
  abstract getChapters(mangaId: string): Promise<Chapter[]>;
  abstract getChapterPages(chapterId: string): Promise<string[]>;

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  protected get isWeb(): boolean {
    return Platform.OS === "web";
  }

  /**
   * Build standard request headers (browser UA, Referer, cookies).
   */
  protected async buildHeaders(
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, string>> {
    const cookieStr = await CookieManager.toCookieString(this.id);
    const headers: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: this.baseUrl.endsWith("/") ? this.baseUrl : this.baseUrl + "/",
      Origin: this.baseUrl,
      ...extraHeaders,
    };
    if (cookieStr) headers.Cookie = cookieStr;
    return headers;
  }

  /**
   * JSON-accepting headers variant.
   */
  protected async buildJsonHeaders(
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, string>> {
    return this.buildHeaders({
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      ...extraHeaders,
    });
  }

  /**
   * Resilient HTTP GET that retries, tracks CF status, and stores cookies.
   * Returns a Response object so callers can choose how to read the body.
   */
  protected async fetchUrl(
    url: string,
    opts: {
      headers?: Record<string, string>;
      timeoutMs?: number;
      retryPolicy?: RetryPolicy;
      signal?: AbortSignal;
    } = {},
  ): Promise<Response> {
    const { timeoutMs = 20000, retryPolicy = DEFAULT_RETRY, signal } = opts;
    const builtHeaders = await this.buildHeaders(opts.headers);

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        // Always use the internal timeout controller for the actual fetch.
        // If an external signal is provided, forward its abort to the internal
        // controller so EITHER the timeout OR the external cancel terminates the
        // request — without passing the external signal directly (which would
        // skip the timeout when an external signal is present).
        let forwardAbort: (() => void) | undefined;
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timer);
            throw new DOMException("signal is aborted without reason", "AbortError");
          }
          forwardAbort = () => controller.abort();
          signal.addEventListener("abort", forwardAbort, { once: true });
        }

        let res: Response;
        try {
          res = await fetch(url, {
            headers: builtHeaders,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
          if (signal && forwardAbort) {
            signal.removeEventListener("abort", forwardAbort);
          }
        }

        // Store any new cookies from the response
        await CookieManager.storeFromHeaders(this.id, res.headers);

        if (res.status === 403 || res.status === 503) {
          const snippet = await res.clone().text().catch(() => "");
          const errType = classifyHttpStatus(res.status, snippet);
          if (errType === "cloudflare") {
            await CloudflareSession.invalidate(this.id);
            throw new RetryableError(
              `Cloudflare protection on ${this.name}`,
              "cloudflare",
              res.status,
            );
          }
        }

        if (!res.ok) {
          const errType = classifyHttpStatus(res.status);
          throw new RetryableError(`HTTP ${res.status}`, errType, res.status);
        }

        return res;
      },
      retryPolicy,
      signal,
    );
  }

  /**
   * Fetch a URL and return the response body as text.
   */
  protected async fetchHtml(
    url: string,
    opts?: Parameters<typeof this.fetchUrl>[1],
  ): Promise<string> {
    const res = await this.fetchUrl(url, opts);
    return res.text();
  }

  /**
   * Fetch a URL and parse the body as JSON.
   */
  protected async fetchJson<T = Record<string, unknown>>(
    url: string,
    opts?: Parameters<typeof this.fetchUrl>[1],
  ): Promise<T> {
    const headers = await this.buildJsonHeaders(opts?.headers);
    const res = await this.fetchUrl(url, { ...opts, headers });
    return res.json() as Promise<T>;
  }

  // ── Cloudflare helpers ────────────────────────────────────────────────────

  protected isCloudflarePage(html: string): boolean {
    return /just a moment|checking your browser|cf-browser-verification|challenge-form|attention required/i.test(html);
  }

  protected async hasValidCFSession(): Promise<boolean> {
    return CloudflareSession.isValid(this.id);
  }

  // ── HTML parsing utilities ────────────────────────────────────────────────

  /** Decode common HTML entities. */
  protected decodeEntities(s: string): string {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#38;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  /** Strip all HTML tags from a string. */
  protected stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").trim();
  }

  /** Extract the content of a meta tag by property or name. */
  protected extractMeta(html: string, nameOrProp: string): string | null {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const m = html.match(re) ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nameOrProp}["']`, "i"));
    return m?.[1] ?? null;
  }

  // ── Date parsing ──────────────────────────────────────────────────────────

  /**
   * Parse a date string into a timestamp.
   * Handles ISO 8601, relative phrases ("2 days ago"), and common formats.
   */
  protected parseDate(raw: string): number {
    if (!raw) return Date.now();

    // ISO / RFC 2822 — let native Date handle it
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.getTime();

    // Relative phrases
    const lower = raw.toLowerCase().trim();
    const relMatch = lower.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
    if (relMatch) {
      const n = parseInt(relMatch[1], 10);
      const unit = relMatch[2];
      const ms: Record<string, number> = {
        second: 1000,
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
        month: 2_592_000_000,
        year: 31_536_000_000,
      };
      return Date.now() - n * (ms[unit] ?? 0);
    }

    // Common short forms: "Jan 5", "5 Jan 2024", "2024-01-05"
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slashMatch) {
      const [, m, dy, y] = slashMatch;
      const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
      return new Date(year, parseInt(m, 10) - 1, parseInt(dy, 10)).getTime();
    }

    return Date.now();
  }

  // ── Status normalization ──────────────────────────────────────────────────

  /**
   * Normalize various status strings from sources into a canonical MangaStatus.
   */
  protected parseMangaStatus(raw: string): MangaStatus | undefined {
    const lower = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (lower.includes("ongoing") || lower.includes("publishing") || lower.includes("releasing")) return "ongoing";
    if (lower.includes("completed") || lower.includes("finished") || lower.includes("complete")) return "completed";
    if (lower.includes("hiatus") || lower.includes("onhold") || lower.includes("paused")) return "hiatus";
    if (lower.includes("cancelled") || lower.includes("canceled") || lower.includes("dropped")) return "cancelled";
    return undefined;
  }

  // ── Next.js data extraction ───────────────────────────────────────────────

  /** Extract embedded __NEXT_DATA__ JSON from a Next.js page. */
  protected extractNextData(html: string): Record<string, unknown> | null {
    const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) return null;
    try {
      return JSON.parse(m[1]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Safely get a deep property value from an object by dot-path. */
  protected deepGet(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  /** Safely cast a value to string, returning empty string if null/undefined. */
  protected safeStr(val: unknown, fallback = ""): string {
    if (typeof val === "string" && val.trim()) return val.trim();
    return fallback;
  }
}
