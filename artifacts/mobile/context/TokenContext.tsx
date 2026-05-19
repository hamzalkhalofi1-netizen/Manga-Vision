import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type TokenStatus = "active" | "rate_limited" | "available";

export interface GeminiToken {
  id: string;
  key: string;
  label: string;
  isRateLimited: boolean;
  rateLimitedUntil: number | null;
  addedAt: number;
}

interface TokenContextType {
  tokens: GeminiToken[];
  activeTokenId: string | null;
  addToken: (key: string, label?: string) => Promise<{ ok: boolean; error?: string }>;
  removeToken: (id: string) => void;
  setActiveToken: (id: string) => void;
  markRateLimited: (id: string, retryAfterMs?: number) => void;
  clearRateLimit: (id: string) => void;
  getActiveKey: () => string | null;
  getTokenStatus: (token: GeminiToken) => TokenStatus;
  autoFallback: () => string | null;
}

const MAX_TOKENS = 5;
const TOKENS_STORAGE_KEY = "mangaverse_gemini_tokens_v2";
const ACTIVE_TOKEN_STORAGE_KEY = "mangaverse_active_token_v2";

const TokenContext = createContext<TokenContextType | null>(null);

function maskKey(key: string): string {
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 8)}••••••••${key.slice(-4)}`;
}

export { maskKey };

function resolveStatus(token: GeminiToken): TokenStatus {
  if (token.isRateLimited) {
    if (token.rateLimitedUntil && Date.now() > token.rateLimitedUntil) {
      return "available";
    }
    return "rate_limited";
  }
  return "available";
}

export function TokenProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<GeminiToken[]>([]);
  const [activeTokenId, setActiveTokenIdState] = useState<string | null>(null);
  const tokensRef = useRef<GeminiToken[]>([]);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    async function load() {
      try {
        const [tokensRaw, activeRaw] = await Promise.all([
          AsyncStorage.getItem(TOKENS_STORAGE_KEY),
          AsyncStorage.getItem(ACTIVE_TOKEN_STORAGE_KEY),
        ]);
        if (tokensRaw) {
          const parsed: GeminiToken[] = JSON.parse(tokensRaw);
          setTokens(parsed);
        }
        if (activeRaw) {
          setActiveTokenIdState(activeRaw);
        }
      } catch {}
    }
    load();
  }, []);

  const persist = useCallback((updated: GeminiToken[]) => {
    AsyncStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const addToken = useCallback(
    async (key: string, label?: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = key.trim();

      if (!trimmed) return { ok: false, error: "Key cannot be empty." };
      if (trimmed.length < 20) return { ok: false, error: "Key is too short to be valid." };
      if (!trimmed.startsWith("AIza")) {
        return { ok: false, error: "Key must start with AIza (Gemini format)." };
      }

      const current = tokensRef.current;
      if (current.length >= MAX_TOKENS) {
        return { ok: false, error: `Maximum ${MAX_TOKENS} keys allowed.` };
      }
      if (current.some((t) => t.key === trimmed)) {
        return { ok: false, error: "This key is already saved." };
      }

      const newToken: GeminiToken = {
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
    },
    [persist]
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

  const getTokenStatus = useCallback((token: GeminiToken): TokenStatus => {
    const base = resolveStatus(token);
    if (base === "available" && token.id === activeTokenId) return "active";
    return base;
  }, [activeTokenId]);

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

  return (
    <TokenContext.Provider
      value={{
        tokens,
        activeTokenId,
        addToken,
        removeToken,
        setActiveToken,
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
