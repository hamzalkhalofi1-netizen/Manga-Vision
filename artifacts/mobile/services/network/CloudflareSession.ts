/**
 * CloudflareSession — Cloudflare bypass session manager.
 *
 * Manages per-source CF clearance sessions. The WebViewBridge handles
 * the actual challenge resolution; this module tracks session state,
 * staleness, and expiry so sources can decide whether to trigger a
 * new verification flow or reuse an existing session.
 *
 * Mihon equivalent: The combination of WebViewActivity + NetworkHelper
 * cookie storage that persists cf_clearance between app sessions.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { CookieManager } from "./CookieManager";

const CF_SESSION_KEY = "@mv_cf_sessions_v1";

/** How long a CF session is considered valid (conservative: 12h). */
const CF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface CFSession {
  sourceId: string;
  cfClearance: string;
  userAgent: string;
  obtainedAt: number;
  expiresAt: number;
}

type CFSessionStore = Record<string, CFSession>;

let _sessions: CFSessionStore | null = null;

async function load(): Promise<CFSessionStore> {
  if (_sessions !== null) return _sessions;
  try {
    const raw = await AsyncStorage.getItem(CF_SESSION_KEY);
    _sessions = raw ? (JSON.parse(raw) as CFSessionStore) : {};
  } catch {
    _sessions = {};
  }
  return _sessions;
}

async function save(): Promise<void> {
  if (!_sessions) return;
  try {
    await AsyncStorage.setItem(CF_SESSION_KEY, JSON.stringify(_sessions));
  } catch {}
}

export const CloudflareSession = {
  /**
   * Check if a source currently has a valid CF session.
   */
  async isValid(sourceId: string): Promise<boolean> {
    const sessions = await load();
    const session = sessions[sourceId];
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      delete sessions[sourceId];
      await save();
      return false;
    }
    // Also check cookie manager has cf_clearance
    return CookieManager.hasCloudflareSession(sourceId);
  },

  /**
   * Store a newly-obtained CF session (called after WebView solves a challenge).
   */
  async store(
    sourceId: string,
    cfClearance: string,
    userAgent: string,
    ttlMs = CF_SESSION_TTL_MS,
  ): Promise<void> {
    const sessions = await load();
    const now = Date.now();
    sessions[sourceId] = {
      sourceId,
      cfClearance,
      userAgent,
      obtainedAt: now,
      expiresAt: now + ttlMs,
    };
    _sessions = sessions;

    // Also persist to CookieManager
    await CookieManager.setCookie(sourceId, {
      name: "cf_clearance",
      value: cfClearance,
      expiresAt: now + ttlMs,
      httpOnly: true,
      secure: true,
    });

    await save();
  },

  /**
   * Get the stored CF session for a source, or null if invalid/absent.
   */
  async get(sourceId: string): Promise<CFSession | null> {
    const isValid = await this.isValid(sourceId);
    if (!isValid) return null;
    const sessions = await load();
    return sessions[sourceId] ?? null;
  },

  /**
   * Get CF clearance cookie value, or null.
   */
  async getClearance(sourceId: string): Promise<string | null> {
    const session = await this.get(sourceId);
    return session?.cfClearance ?? null;
  },

  /**
   * Invalidate a source's CF session (e.g., after a new 403 challenge).
   */
  async invalidate(sourceId: string): Promise<void> {
    const sessions = await load();
    delete sessions[sourceId];
    _sessions = sessions;
    await CookieManager.deleteCookie(sourceId, "cf_clearance");
    await save();
  },

  /**
   * Clear all CF sessions.
   */
  async clearAll(): Promise<void> {
    _sessions = {};
    try {
      await AsyncStorage.removeItem(CF_SESSION_KEY);
    } catch {}
  },

  /**
   * Time remaining on the current session in ms. 0 if expired/absent.
   */
  async getTimeRemaining(sourceId: string): Promise<number> {
    const sessions = await load();
    const session = sessions[sourceId];
    if (!session) return 0;
    return Math.max(0, session.expiresAt - Date.now());
  },
};
