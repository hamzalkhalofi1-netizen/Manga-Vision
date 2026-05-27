/**
 * CookieManager — Structured cookie jar for manga sources.
 *
 * Replaces the raw cookie strings in sessionStore.ts with a proper
 * per-source cookie jar that understands Set-Cookie headers, attribute
 * parsing (Path, Domain, Max-Age, HttpOnly, Secure), and expiry.
 *
 * Mihon equivalent: OkHttp CookieJar + PersistentCookieStore.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@mv_cookies_v1";

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expiresAt?: number; // unix ms, undefined = session cookie
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

type CookieJar = Record<string, Cookie>; // keyed by name
type AllJars = Record<string, CookieJar>; // keyed by sourceId

let _jars: AllJars | null = null;
let _dirty = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<AllJars> {
  if (_jars !== null) return _jars;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    _jars = raw ? (JSON.parse(raw) as AllJars) : {};
  } catch {
    _jars = {};
  }
  return _jars;
}

function scheduleSave(): void {
  _dirty = true;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!_dirty || !_jars) return;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_jars));
      _dirty = false;
    } catch {}
  }, 1500);
}

/**
 * Parse a Set-Cookie header string into a Cookie object.
 * E.g. "cf_clearance=abc123; Path=/; HttpOnly; Max-Age=86400"
 */
export function parseSetCookieHeader(header: string): Cookie | null {
  const parts = header.split(";").map((p) => p.trim());
  if (parts.length === 0) return null;
  const first = parts[0];
  const eqIdx = first.indexOf("=");
  if (eqIdx <= 0) return null;

  const cookie: Cookie = {
    name: first.slice(0, eqIdx).trim(),
    value: first.slice(eqIdx + 1).trim(),
  };

  for (const attr of parts.slice(1)) {
    const lower = attr.toLowerCase();
    if (lower.startsWith("domain=")) cookie.domain = attr.slice(7).trim();
    else if (lower.startsWith("path=")) cookie.path = attr.slice(5).trim();
    else if (lower.startsWith("max-age=")) {
      const age = parseInt(attr.slice(8), 10);
      if (!isNaN(age)) cookie.expiresAt = Date.now() + age * 1000;
    } else if (lower.startsWith("expires=")) {
      const d = new Date(attr.slice(8).trim());
      if (!isNaN(d.getTime())) cookie.expiresAt = d.getTime();
    } else if (lower === "httponly") cookie.httpOnly = true;
    else if (lower === "secure") cookie.secure = true;
    else if (lower.startsWith("samesite=")) {
      const v = attr.slice(9).trim().toLowerCase();
      if (v === "strict") cookie.sameSite = "Strict";
      else if (v === "none") cookie.sameSite = "None";
      else cookie.sameSite = "Lax";
    }
  }

  return cookie;
}

export const CookieManager = {
  /**
   * Get all live (non-expired) cookies for a source.
   */
  async getCookies(sourceId: string): Promise<Cookie[]> {
    const jars = await load();
    const jar = jars[sourceId] ?? {};
    const now = Date.now();
    return Object.values(jar).filter(
      (c) => c.expiresAt === undefined || c.expiresAt > now
    );
  },

  /**
   * Get a specific cookie by name.
   */
  async getCookie(sourceId: string, name: string): Promise<Cookie | null> {
    const jars = await load();
    const cookie = jars[sourceId]?.[name];
    if (!cookie) return null;
    if (cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now()) {
      delete jars[sourceId][name];
      scheduleSave();
      return null;
    }
    return cookie;
  },

  /**
   * Store a cookie for a source.
   */
  async setCookie(sourceId: string, cookie: Cookie): Promise<void> {
    const jars = await load();
    if (!jars[sourceId]) jars[sourceId] = {};
    jars[sourceId][cookie.name] = cookie;
    scheduleSave();
  },

  /**
   * Parse and store cookies from Set-Cookie response headers.
   */
  async storeFromHeaders(sourceId: string, headers: Headers | Record<string, string>): Promise<void> {
    const cookieHeaders: string[] = [];

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") cookieHeaders.push(value);
      });
    } else {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "set-cookie") cookieHeaders.push(value);
      }
    }

    for (const header of cookieHeaders) {
      const cookie = parseSetCookieHeader(header);
      if (cookie && cookie.name) {
        await this.setCookie(sourceId, cookie);
      }
    }
  },

  /**
   * Format all live cookies as a Cookie header string.
   * E.g. "cf_clearance=abc123; session_id=xyz"
   */
  async toCookieString(sourceId: string): Promise<string> {
    const cookies = await this.getCookies(sourceId);
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  },

  /**
   * Remove a specific cookie.
   */
  async deleteCookie(sourceId: string, name: string): Promise<void> {
    const jars = await load();
    if (jars[sourceId]) {
      delete jars[sourceId][name];
      scheduleSave();
    }
  },

  /**
   * Clear all cookies for a source.
   */
  async clearSource(sourceId: string): Promise<void> {
    const jars = await load();
    delete jars[sourceId];
    scheduleSave();
  },

  /**
   * Clear all cookies for all sources.
   */
  async clearAll(): Promise<void> {
    _jars = {};
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}
  },

  /**
   * Check if a source has a valid cf_clearance cookie (not expired).
   */
  async hasCloudflareSession(sourceId: string): Promise<boolean> {
    const cf = await this.getCookie(sourceId, "cf_clearance");
    return cf !== null;
  },
};
