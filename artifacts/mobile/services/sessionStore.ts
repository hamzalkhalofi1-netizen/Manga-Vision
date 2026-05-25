import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SourceSession {
  cookies: Record<string, string>;
  userAgent?: string;
  updatedAt: number;
}

const KEY_PREFIX = "@sourceSession/";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const cache = new Map<string, SourceSession | null>();

export const sessionStore = {
  async getSession(sourceId: string): Promise<SourceSession | null> {
    if (cache.has(sourceId)) return cache.get(sourceId) ?? null;
    try {
      const raw = await AsyncStorage.getItem(`${KEY_PREFIX}${sourceId}`);
      if (raw) {
        const session = JSON.parse(raw) as SourceSession;
        if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
          await AsyncStorage.removeItem(`${KEY_PREFIX}${sourceId}`);
          cache.set(sourceId, null);
          return null;
        }
        cache.set(sourceId, session);
        return session;
      }
    } catch {}
    cache.set(sourceId, null);
    return null;
  },

  async setSession(
    sourceId: string,
    cookies: Record<string, string>,
    userAgent?: string,
  ): Promise<void> {
    const existing = await this.getSession(sourceId);
    const session: SourceSession = {
      cookies: { ...(existing?.cookies ?? {}), ...cookies },
      userAgent: userAgent ?? existing?.userAgent,
      updatedAt: Date.now(),
    };
    cache.set(sourceId, session);
    try {
      await AsyncStorage.setItem(`${KEY_PREFIX}${sourceId}`, JSON.stringify(session));
    } catch {}
  },

  async clearSession(sourceId: string): Promise<void> {
    cache.delete(sourceId);
    try {
      await AsyncStorage.removeItem(`${KEY_PREFIX}${sourceId}`);
    } catch {}
  },

  parseCookieHeader(cookieHeader: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) {
        result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
      }
    }
    return result;
  },

  cookiesToString(cookies: Record<string, string>): string {
    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  },
};
