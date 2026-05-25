import { Platform } from "react-native";
import { sessionStore } from "../sessionStore";
import { sourceHealth, SourceErrorType } from "../sourceHealth";

export { SourceErrorType };

export class SourceError extends Error {
  constructor(
    message: string,
    public readonly type: SourceErrorType,
    public readonly statusCode?: number,
    public readonly sourceId?: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const isWeb = Platform.OS === "web";

const RETRY_DELAYS_MS = [1000, 2500, 5000];

export interface SourceFetchOptions {
  sourceId: string;
  siteUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

function getProxyBase(): string {
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/source-proxy`;
}

function classifyStatus(status: number, bodySnippet = ""): SourceErrorType {
  if (status === 429) return "rate_limit";
  if (status === 404) return "not_found";
  if (status === 401) return "auth";
  if (status === 403 || status === 503) {
    if (
      bodySnippet.includes("cloudflare_challenge") ||
      bodySnippet.includes("cf_clearance") ||
      bodySnippet.includes("cf-ray")
    )
      return "cloudflare";
    return status === 403 ? "auth" : "upstream";
  }
  if (status >= 500) return "upstream";
  return "network";
}

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Make a resilient fetch to a source URL (or its web-proxy equivalent).
 * Handles retries, backoff, browser headers, session cookies, and health tracking.
 */
export async function sourceFetch(
  url: string,
  opts: SourceFetchOptions,
  init?: RequestInit,
): Promise<Response> {
  const { sourceId, siteUrl, headers = {}, timeoutMs = 15000, maxRetries = 3 } = opts;

  const health = await sourceHealth.getHealth(sourceId);
  if (sourceHealth.isDisabled(health)) {
    const remainingMin = Math.ceil(sourceHealth.getDisabledRemaining(health) / 60000);
    throw new SourceError(
      `${sourceId} is temporarily disabled (${remainingMin}m). ` +
        (health.lastErrorType === "cloudflare"
          ? "Browser verification required."
          : "Too many failures."),
      health.lastErrorType ?? "upstream",
      undefined,
      sourceId,
    );
  }

  const session = await sessionStore.getSession(sourceId);
  const cookieStr = session ? sessionStore.cookiesToString(session.cookies) : "";

  const baseHeaders: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: siteUrl.endsWith("/") ? siteUrl : siteUrl + "/",
    Origin: siteUrl,
    ...headers,
  };

  if (cookieStr && !isWeb) {
    baseHeaders.Cookie = cookieStr;
  }

  let lastErr: SourceError | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await wait(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
    }

    const proxyHeaders: Record<string, string> = {};
    if (isWeb && session) {
      const cf = session.cookies["cf_clearance"];
      if (cf) proxyHeaders["x-cf-clearance"] = cf;
      if (cookieStr) proxyHeaders["x-source-cookie"] = cookieStr;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          headers: { ...baseHeaders, ...proxyHeaders, ...(init?.headers as Record<string, string> ?? {}) },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 403 || res.status === 503) {
        let snippet = "";
        try {
          snippet = await res.clone().text();
        } catch {}
        const errType = classifyStatus(res.status, snippet);
        if (errType === "cloudflare") {
          await sourceHealth.recordFailure(sourceId, "cloudflare");
          throw new SourceError(
            `Cloudflare protection on ${sourceId}`,
            "cloudflare",
            res.status,
            sourceId,
          );
        }
      }

      if (res.status === 429) {
        await sourceHealth.recordFailure(sourceId, "rate_limit");
        if (attempt < maxRetries - 1) {
          const retryAfter = res.headers.get("retry-after");
          await wait(retryAfter ? parseInt(retryAfter, 10) * 1000 : RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new SourceError(`Rate limited by ${sourceId}`, "rate_limit", 429, sourceId);
      }

      if (!res.ok) {
        const errType = classifyStatus(res.status);
        if (attempt < maxRetries - 1 && ![401, 403, 404].includes(res.status)) {
          lastErr = new SourceError(`HTTP ${res.status}`, errType, res.status, sourceId);
          continue;
        }
        await sourceHealth.recordFailure(sourceId, errType);
        throw new SourceError(`HTTP ${res.status} from ${sourceId}`, errType, res.status, sourceId);
      }

      await sourceHealth.recordSuccess(sourceId);
      return res;
    } catch (err) {
      if (err instanceof SourceError) throw err;
      const isAbort = err instanceof Error && err.name === "AbortError";
      lastErr = new SourceError(
        isAbort ? `Timeout on ${sourceId}` : (err instanceof Error ? err.message : "Network error"),
        "network",
        undefined,
        sourceId,
      );
      if (attempt < maxRetries - 1) continue;
    }
  }

  await sourceHealth.recordFailure(sourceId, "network");
  throw lastErr ?? new SourceError("Request failed", "network", undefined, sourceId);
}

export interface ProxiedFetchOptions extends SourceFetchOptions {
  /**
   * When true, always fetch directly (no server proxy) even on web.
   * Use for APIs that have CORS headers enabled (e.g. ComicK, MANGA Plus).
   * These work from the user's browser but Replit's server IP may be flagged.
   */
  directOnWeb?: boolean;
}

/**
 * Fetches via server-side proxy on web (for CORS), direct on native.
 * If opts.directOnWeb is true, always uses direct fetch regardless of platform.
 *
 * @param proxyId  - registry key in /api/source-proxy/:proxyId (ignored when directOnWeb)
 * @param path     - path after the source base URL (e.g. "/v1.0/search")
 * @param query    - query string including "?" or ""
 * @param opts     - fetch options + directOnWeb flag
 */
export async function proxiedFetch(
  proxyId: string,
  path: string,
  query: string,
  opts: ProxiedFetchOptions,
  init?: RequestInit,
): Promise<Response> {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const directUrl = opts.siteUrl.replace(/\/$/, "") + "/" + cleanPath + query;

  if (!isWeb || opts.directOnWeb) {
    return sourceFetch(directUrl, opts, init);
  }
  // Web: route through server proxy
  const url = `${getProxyBase()}/${proxyId}/${cleanPath}${query}`;
  return sourceFetch(url, opts, init);
}
