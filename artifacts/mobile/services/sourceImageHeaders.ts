/**
 * Returns the HTTP headers needed to load chapter images from a given source.
 *
 * Some sources (MangaFire, Asura, etc.) apply hotlink protection via:
 *  - Referer check  — request must come from the source's own domain
 *  - User-Agent check — must look like a real browser
 *  - Cookie check  — must have a valid session / cf_clearance
 *
 * These headers are injected into expo-image and any manual fetch calls.
 */

import { sessionStore } from "./sessionStore";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCE_REFERERS: Record<string, string> = {
  mangafire: "https://mangafire.to/",
  asura: "https://asuracomic.net/",
  comick: "https://comick.io/",
  mangadex: "https://mangadex.org/",
  mangaplus: "https://mangaplus.shueisha.co.jp/",
  naver: "https://www.webtoons.com/",
};

export interface ImageHeaders {
  Referer: string;
  "User-Agent": string;
  Cookie?: string;
}

/**
 * Returns headers for loading images from a given source.
 * Includes session cookies if available.
 */
export async function getImageHeaders(sourceId: string): Promise<ImageHeaders> {
  const referer = SOURCE_REFERERS[sourceId] ?? "https://mangadex.org/";
  const session = await sessionStore.getSession(sourceId);
  const cookieStr = session ? sessionStore.cookiesToString(session.cookies) : "";

  const headers: ImageHeaders = {
    Referer: referer,
    "User-Agent": BROWSER_UA,
  };

  if (cookieStr) {
    headers.Cookie = cookieStr;
  }

  return headers;
}

/**
 * Synchronous version for use in render functions — returns basic headers
 * without cookies (cookies require async). Use getImageHeaders when possible.
 */
export function getBasicImageHeaders(sourceId: string): Record<string, string> {
  return {
    Referer: SOURCE_REFERERS[sourceId] ?? "https://mangadex.org/",
    "User-Agent": BROWSER_UA,
  };
}
