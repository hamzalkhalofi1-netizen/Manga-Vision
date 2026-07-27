/**
 * ImageLoader — Image header and URL utilities for source adapters.
 *
 * Centralizes per-source Referer and User-Agent configuration so every
 * adapter gets correct hotlink-bypass headers without reimplementing them.
 * Also provides helpers for rewriting image URLs through the server proxy
 * when needed on the web platform.
 */

import { Platform } from "react-native";
import { CookieManager } from "../network/CookieManager";
import { ENGINE_BROWSER_UA } from "./httpClient";

// ── Per-source Referer map ───────────────────────────────────────────────────

/**
 * Referer URLs required by each source's CDN to allow image hotlinking.
 * Must match what the CDN's anti-hotlink rules expect.
 */
const SOURCE_REFERERS: Record<string, string> = {
  mangadex:   "https://mangadex.org/",
  mangafire:  "https://mangafire.to/",
  asura:      "https://asurascans.com/",
  bato:       "https://bato.to/",
  comick:     "https://comick.io/",
  mangaplus:  "https://mangaplus.shueisha.co.jp/",
  naver:      "https://www.webtoons.com/",
  // MangaKakalot / Manganato — migrated to natomanga.com (chapmanganato.to is squatted)
  kakalot:    "https://www.natomanga.com/",
  manganato:  "https://www.natomanga.com/",
  // Manganelo — now targets mangagg.com (readmanganelo.com is dead)
  manganelo:  "https://mangagg.com/",
};

/** Fallback Referer when no source-specific entry exists. */
const DEFAULT_REFERER = "https://mangadex.org/";

// ── CDN host → proxy ID map ──────────────────────────────────────────────────

/**
 * Maps a CDN hostname directly to the server-proxy registry ID.
 *
 * Hostname-based detection means adapters never need to call maybeProxyUrl()
 * themselves — any URL from any supported CDN is automatically rewritten on
 * the web platform, regardless of which source produced it.
 *
 * IMPORTANT: keep in sync with SOURCE_REGISTRY in source-proxy.ts.
 */
const CDN_HOST_PROXY_MAP: Record<string, string> = {
  // natomanga.com chapter-image CDN (kakalot / manganato)
  "img-r1.2xstorage.com":   "natomanga-cdn",
  "imgs-2.2xstorage.com":   "natomanga-cdn2",
  // natomanga.com listing thumbnail CDN (img-r2 subdomain)
  "img-r2.2xstorage.com":   "natomanga-cdn-thumb",
  // natomanga.com detail-page cover CDN (og:image)
  "storage.waitst.com":     "natomanga-cover",
  // mangagg.com main site (covers live at /wp-content/…)
  "mangagg.com":            "mangagg",
  // mangagg.com chapter-image CDN
  "s4.mangagg.com":         "mangagg-cdn",
  // Other sources (existing)
  "cdn.asurascans.com":     "asura-cdn",
  "cdn.mangafire.to":       "mangafire-cdn",
  "uploads.mangadex.org":   "mangadex-cdn",
  "meo.comick.pictures":    "comick-cdn",
};

const PROXY_BASE = "/api/source-proxy";
const isWeb = Platform.OS === "web";

// ── Public API ───────────────────────────────────────────────────────────────

export interface ImageHeaders {
  Referer: string;
  "User-Agent": string;
  Cookie?: string;
}

export const ImageLoader = {
  /**
   * Synchronous minimal headers (no cookies). Safe to call from render functions.
   * Use `getHeadersAsync` when cookies are required.
   */
  getHeaders(sourceId: string): ImageHeaders {
    return {
      Referer: SOURCE_REFERERS[sourceId] ?? DEFAULT_REFERER,
      "User-Agent": ENGINE_BROWSER_UA,
    };
  },

  /**
   * Full async headers including any persisted session cookies.
   */
  async getHeadersAsync(sourceId: string): Promise<ImageHeaders> {
    const cookieStr = await CookieManager.toCookieString(sourceId);
    const headers: ImageHeaders = {
      Referer: SOURCE_REFERERS[sourceId] ?? DEFAULT_REFERER,
      "User-Agent": ENGINE_BROWSER_UA,
    };
    if (cookieStr) headers.Cookie = cookieStr;
    return headers;
  },

  /**
   * Returns the Referer for a given CDN URL.
   * When the URL contains the source domain, the per-source Referer is used.
   * Falls back to the base Referer for the provided sourceId.
   */
  getCdnReferer(url: string, sourceId: string): string {
    for (const [id, referer] of Object.entries(SOURCE_REFERERS)) {
      const domain = referer.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (url.includes(domain)) return referer;
    }
    return SOURCE_REFERERS[sourceId] ?? DEFAULT_REFERER;
  },

  /**
   * On web, rewrite a CDN image URL through the server proxy so the proxy
   * can inject the correct Referer/Origin headers required by the CDN's
   * hotlink-protection rules. On native, the URL is returned unchanged
   * (headers are injected directly by ImageDiskCache / expo-file-system).
   *
   * Detection is hostname-based: CDN_HOST_PROXY_MAP maps each supported CDN
   * domain to its server-proxy registry ID. No sourceId parameter is needed,
   * so callers do not need to know which source produced the URL.
   *
   * Returns the original URL when:
   *   - running on native (non-web) platform, or
   *   - the hostname is not in CDN_HOST_PROXY_MAP (URL passes through as-is).
   */
  maybeProxyUrl(imageUrl: string): string {
    if (!isWeb) return imageUrl;
    if (!imageUrl) return imageUrl;
    try {
      const parsed = new URL(imageUrl);
      const proxyId = CDN_HOST_PROXY_MAP[parsed.hostname];
      if (!proxyId) return imageUrl;
      const cleanPath = parsed.pathname.startsWith("/")
        ? parsed.pathname.slice(1)
        : parsed.pathname;
      const qs = parsed.search ?? "";
      return `${PROXY_BASE}/${proxyId}/${cleanPath}${qs}`;
    } catch {
      return imageUrl;
    }
  },
};
