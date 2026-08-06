import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { testGeminiKey, type KeyTestResult } from "@/services/geminiKeyTest";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TokenStatus = "active" | "rate_limited" | "available";

export interface GeminiToken {
  id: string;
  key: string;
  label: string;
  isRateLimited: boolean;
  rateLimitedUntil: number | null;
  addedAt: number;
  // v3+ metadata (may be missing on tokens loaded from older storage → default values applied)
  lastUsed: number | null;
  latencyMs: number | null;
  requestCount: number;
  detectedModel: string | null;
}

interface TokenContextType {
  tokens: GeminiToken[];
  activeTokenId: string | null;
  autoRotation: boolean;
  setAutoRotation: (v: boolean) => void;
  addToken: (key: string, label?: string) => Promise<{ ok: boolean; error?: string }>;
  removeToken: (id: string) => void;
  setActiveToken: (id: string) => void;
  renameToken: (id: string, label: string) => void;
  editTokenKey: (id: string, newKey: string) => Promise<{ ok: boolean; error?: string }>;
  recordUsage: (id: string, latencyMs: number) => void;
  testToken: (id: string) => Promise<KeyTestResult>;
  markRateLimited: (id: string, retryAfterMs?: number) => void;
  clearRateLimit: (id: string) => void;
  getActiveKey: () => string | null;
  getTokenStatus: (token: GeminiToken) => TokenStatus;
  autoFallback: () => string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_TOKENS = 10;
const TOKENS_STORAGE_KEY = "mangaverse_gemini_tokens_v3";
const ACTIVE_TOKEN_STORAGE_KEY = "mangaverse_active_token_v2";
const AUTO_ROTATION_KEY = "mangaverse_auto_rotation";

// Legacy key — we'll migrate from v2 if v3 is empty
const TOKENS_LEGACY_KEY = "mangaverse_gemini_tokens_v2";

const TOKEN_DEFAULTS: Pick<GeminiToken, "lastUsed" | "latencyMs" | "requestCount" | "detectedModel"> = {
  lastUsed: null,
  latencyMs: null,
  requestCount: 0,
  detectedModel: null,
};

const TokenContext = createContext<TokenContextType | null>(null);

// ── Helpers ────────────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export { maskKey };

function resolveStatus(token: GeminiToken): TokenStatus {
  if (token.isRateLimited) {
    if (token.rateLimitedUntil && Date.now() > token.rateLimitedUntil) {
      return "available"; // cooldown expired
    }
    return "rate_limited";
  }
  return "available";
}

/** Merge v3 defaults onto a token that may be missing the new fields */
function hydrateToken(raw: Partial<GeminiToken> & Pick<GeminiToken, "id" | "key" | "label">): GeminiToken {
  return {
    isRateLimited: false,
    rateLimitedUntil: null,
    addedAt: Date.now(),
    ...TOKEN_DEFAULTS,
    ...raw,
  };
}

/** Validate key format — accepts any key ≥ 20 chars (no prefix requirement) */
function validateKey(trimmed: string): string | null {
  if (!trimmed) return "Key cannot be empty.";
  if (trimmed.length < 20) return "Key is too short to be valid (min 20 characters).";
  return null; // valid
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function TokenProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<GeminiToken[]>([]);
  const [activeTokenId, setActiveTokenIdState] = useState<string | null>(null);
  const [autoRotation, setAutoRotationState] = useState(true);
  const tokensRef = useRef<GeminiToken[]>([]);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  // ── Hydration ────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [v3Raw, v2Raw, activeRaw, rotationRaw] = await Promise.all([
          AsyncStorage.getItem(TOKENS_STORAGE_KEY),
          AsyncStorage.getItem(TOKENS_LEGACY_KEY),
          AsyncStorage.getItem(ACTIVE_TOKEN_STORAGE_KEY),
          AsyncStorage.getItem(AUTO_ROTATION_KEY),
        ]);

        // Prefer v3; fall back to migrating v2
        const raw = v3Raw ?? v2Raw;
        if (raw) {
          const parsed: Partial<GeminiToken>[] = JSON.parse(raw);
          const hydrated = parsed.map((t) =>
            hydrateToken(t as Partial<GeminiToken> & Pick<GeminiToken, "id" | "key" | "label">)
          );
          setTokens(hydrated);
          // Migrate v2 → v3 silently
          if (!v3Raw && v2Raw) {
            AsyncStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(hydrated));
          }
        }
        if (activeRaw) setActiveTokenIdState(activeRaw);
        if (rotationRaw !== null) setAutoRotationState(rotationRaw === "true");
      } catch {}
    }
    load();
  }, []);

  // ── Persistence ───────────────────────────────────────────────────────────────

  const persist = useCallback((updated: GeminiToken[]) => {
    AsyncStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(updated));
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const addToken = useCallback(
    async (key: string, label?: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = key.trim();
      const validationError = validateKey(trimmed);
      if (validationError) return { ok: false, error: validationError };

      const current = tokensRef.current;
      if (current.length >= MAX_TOKENS) {
        return { ok: false, error: `Maximum ${MAX_TOKENS} keys allowed.` };
      }
      if (current.some((t) => t.key === trimmed)) {
        return { ok: false, error: "This key is already saved." };
      }

      const newToken: GeminiToken = {
        ...TOKEN_DEFAULTS,
        id: Date.now().toString(),
        key: trimmed,
        label: label || `Key ${current.length + 1}`,
        isRateLimited: false,
        rateLimitedUntil: null,
        addedAt: Date.now(),
      };

      const updated = [...current, newToken];
      setTokens(updated);
      persist(updated);

      if (current.length === 0) {
        setActiveTokenIdState(newToken.id);
        AsyncStorage.setItem(ACTIVE_TOKEN_STORAGE_KEY, newToken.id);
      }

      return { ok: true };
    },
    [persist]
  );

  const removeToken = useCallback(
    (id: string) => {
      setTokens((prev) => {
        const updated = prev.filter((t) => t.id !== id);
        persist(updated);
        return updated;
      });
      setActiveTokenIdState((prev) => {
        if (prev === id) {
          AsyncStorage.removeItem(ACTIVE_TOKEN_STORAGE_KEY);
          return null;
        }
        return prev;
      });
    },
    [persist]
  );

  const setActiveToken = useCallback((id: string) => {
    setActiveTokenIdState(id);
    AsyncStorage.setItem(ACTIVE_TOKEN_STORAGE_KEY, id);
  }, []);

  const renameToken = useCallback(
    (id: string, label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      setTokens((prev) => {
        const updated = prev.map((t) => (t.id === id ? { ...t, label: trimmed } : t));
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const editTokenKey = useCallback(
    async (id: string, newKey: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = newKey.trim();
      const validationError = validateKey(trimmed);
      if (validationError) return { ok: false, error: validationError };

      const current = tokensRef.current;
      if (current.some((t) => t.key === trimmed && t.id !== id)) {
        return { ok: false, error: "This key is already saved." };
      }

      setTokens((prev) => {
        const updated = prev.map((t) =>
          t.id === id
            ? {
                ...t,
                key: trimmed,
                isRateLimited: false,
                rateLimitedUntil: null,
                lastUsed: null,
                latencyMs: null,
                requestCount: 0,
                detectedModel: null,
              }
            : t
        );
        persist(updated);
        return updated;
      });

      return { ok: true };
    },
    [persist]
  );

  const recordUsage = useCallback(
    (id: string, latencyMs: number) => {
      setTokens((prev) => {
        const updated = prev.map((t) =>
          t.id === id
            ? {
                ...t,
                lastUsed: Date.now(),
                latencyMs: t.latencyMs === null ? latencyMs : Math.round((t.latencyMs + latencyMs) / 2),
                requestCount: (t.requestCount ?? 0) + 1,
              }
            : t
        );
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const testToken = useCallback(
    async (id: string): Promise<KeyTestResult> => {
      const token = tokensRef.current.find((t) => t.id === id);
      if (!token) {
        return { ok: false, supportedModel: null, latencyMs: 0, error: "Token not found", errorCode: "UNKNOWN" };
      }

      const result = await testGeminiKey(token.key);

      // Update token with test results
      setTokens((prev) => {
        const updated = prev.map((t) =>
          t.id === id
            ? {
                ...t,
                lastUsed: Date.now(),
                latencyMs: result.latencyMs > 0 ? result.latencyMs : t.latencyMs,
                detectedModel: result.supportedModel ?? t.detectedModel,
                // If quota exceeded, key is valid — clear rate limit flag if it was stale
                isRateLimited: result.errorCode === "QUOTA_EXCEEDED" ? true : result.ok ? false : t.isRateLimited,
                rateLimitedUntil: result.errorCode === "QUOTA_EXCEEDED"
                  ? Date.now() + 60_000
                  : result.ok ? null : t.rateLimitedUntil,
              }
            : t
        );
        persist(updated);
        return updated;
      });

      return result;
    },
    [persist]
  );

  const markRateLimited = useCallback(
    (id: string, retryAfterMs = 70_000) => {
      setTokens((prev) => {
        const updated = prev.map((t) =>
          t.id === id
            ? { ...t, isRateLimited: true, rateLimitedUntil: Date.now() + retryAfterMs }
            : t
        );
        persist(updated);
        return updated;
      });

      // Auto-rotate to next available key if enabled
      if (autoRotation) {
        const current = tokensRef.current;
        const next = current.find(
          (t) => t.id !== id && resolveStatus(t) !== "rate_limited"
        );
        if (next) {
          setActiveTokenIdState(next.id);
          AsyncStorage.setItem(ACTIVE_TOKEN_STORAGE_KEY, next.id);
        }
      }
    },
    [persist, autoRotation]
  );

  const clearRateLimit = useCallback(
    (id: string) => {
      setTokens((prev) => {
        const updated = prev.map((t) =>
          t.id === id ? { ...t, isRateLimited: false, rateLimitedUntil: null } : t
        );
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const setAutoRotation = useCallback((v: boolean) => {
    setAutoRotationState(v);
    AsyncStorage.setItem(AUTO_ROTATION_KEY, String(v));
  }, []);

  // ── Read-only ──────────────────────────────────────────────────────────────────

  const getTokenStatus = useCallback(
    (token: GeminiToken): TokenStatus => {
      const base = resolveStatus(token);
      if (base === "available" && token.id === activeTokenId) return "active";
      return base;
    },
    [activeTokenId]
  );

  const getActiveKey = useCallback((): string | null => {
    if (!activeTokenId) return null;
    const token = tokensRef.current.find((t) => t.id === activeTokenId);
    if (!token) return null;
    if (resolveStatus(token) === "rate_limited") return null;
    return token.key;
  }, [activeTokenId]);

  const autoFallback = useCallback((): string | null => {
    const current = tokensRef.current;
    const available = current.filter((t) => resolveStatus(t) !== "rate_limited");
    if (available.length === 0) return null;
    const preferred = available.find((t) => t.id === activeTokenId);
    return (preferred ?? available[0]).key;
  }, [activeTokenId]);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <TokenContext.Provider
      value={{
        tokens,
        activeTokenId,
        autoRotation,
        setAutoRotation,
        addToken,
        removeToken,
        setActiveToken,
        renameToken,
        editTokenKey,
        recordUsage,
        testToken,
        markRateLimited,
        clearRateLimit,
        getActiveKey,
        getTokenStatus,
        autoFallback,
      }}
    >
      {children}
    </TokenContext.Provider>
  );
}

export function useTokens() {
  const ctx = useContext(TokenContext);
  if (!ctx) throw new Error("useTokens must be used within TokenProvider");
  return ctx;
}
