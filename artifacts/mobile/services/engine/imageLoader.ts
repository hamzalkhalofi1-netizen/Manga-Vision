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
  mangadex: "https://mangadex.org/",
  mangafire: "https://mangafire.to/",
  asura: "https://asurascans.com/",
  bato: "https://bato.to/",
  comick: "https://comick.io/",
  mangaplus: "https://mangaplus.shueisha.co.jp/",
  naver: "https://www.webtoons.com/",
  kakalot: "https://chapmanganato.to/",
  manganato: "https://chapmanganato.to/",
  manganelo: "https://chapmanganato.to/",
};

/** Fallback Referer when no source-specific entry exists. */
const DEFAULT_REFERER = "https://mangadex.org/";

// ── Proxy entry map ──────────────────────────────────────────────────────────

/**
 * Source proxy IDs for CDN domains on the web platform.
 * When a source's images need Referer headers the browser won't send,
 * the image URL must be rewritten through the server proxy.
 */
const CDN_PROXY_IDS: Record<string, string> = {
  asura: "asura-cdn",
  mangafire: "mangafire-cdn",
  mangadex: "mangadex-cdn",
  comick: "comick-cdn",
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
   * can add the correct Referer header. On native, returns the URL unchanged.
   *
   * Only rewrites when a CDN proxy entry exists for the source.
   */
  maybeProxyUrl(imageUrl: string, sourceId: string): string {
    if (!isWeb) return imageUrl;
    const proxyId = CDN_PROXY_IDS[sourceId];
    if (!proxyId) return imageUrl;

    try {
      const parsed = new URL(imageUrl);
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
