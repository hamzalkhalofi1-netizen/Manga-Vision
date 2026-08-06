/**
 * geminiKeyTest.ts
 *
 * Standalone Gemini API key validator.
 * Tests a key by making a minimal real API call (no translation logic).
 * Does NOT modify geminiTranslate.ts or translationQueue.ts.
 */

import { GoogleGenAI } from "@google/genai";

// ── Types ──────────────────────────────────────────────────────────────────────

export type GeminiModel =
  | "gemini-2.5-flash"
  | "gemini-2.5-pro"
  | "gemini-2.0-flash-lite";

export interface GeminiModelInfo {
  id: GeminiModel;
  displayName: string;
  tagline: string;
  tier: "free" | "paid";
  rpm: number;   // requests per minute (free tier)
  rpd: number;   // requests per day (free tier)
  recommended: boolean;
}

export const GEMINI_MODELS: GeminiModelInfo[] = [
  {
    id: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    tagline: "Best balance of speed & accuracy for manga OCR",
    tier: "free",
    rpm: 10,
    rpd: 500,
    recommended: true,
  },
  {
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    tagline: "Highest accuracy — complex pages, dense text",
    tier: "paid",
    rpm: 5,
    rpd: 25,
    recommended: false,
  },
  {
    id: "gemini-2.0-flash-lite",
    displayName: "Gemini Flash Lite",
    tagline: "Fastest response, great for simple pages",
    tier: "free",
    rpm: 30,
    rpd: 1500,
    recommended: false,
  },
];

export type KeyTestErrorCode =
  | "INVALID_KEY"
  | "QUOTA_EXCEEDED"
  | "MODEL_NOT_SUPPORTED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface KeyTestResult {
  ok: boolean;
  /** Which model responded successfully, or null if all failed. */
  supportedModel: GeminiModel | null;
  latencyMs: number;
  error?: string;
  errorCode?: KeyTestErrorCode;
}

// ── Test prompt — absolute minimum tokens ─────────────────────────────────────

const TEST_PROMPT = "Reply with exactly one word: OK";
const TEST_CONFIG = { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } };

// ── Key format detection ───────────────────────────────────────────────────────

export type KeyFormatHint = "gemini" | "plausible" | "too_short" | "empty";

/**
 * Heuristically detect key format without making an API call.
 * - "gemini":   starts with AIza (Google API key format)
 * - "plausible": length ≥ 20, unknown format
 * - "too_short": length < 20
 * - "empty":    blank
 */
export function detectKeyFormat(raw: string): KeyFormatHint {
  const key = raw.trim();
  if (!key) return "empty";
  if (key.length < 20) return "too_short";
  if (key.startsWith("AIza")) return "gemini";
  return "plausible";
}

// ── Main test function ─────────────────────────────────────────────────────────

/**
 * Test a Gemini API key validity by making a real (minimal) API call.
 * Tries gemini-2.5-flash first; falls back to flash-lite on model errors.
 * A 429 means the key IS valid — just quota-exceeded.
 */
export async function testGeminiKey(apiKey: string): Promise<KeyTestResult> {
  const trimmed = apiKey.trim();

  if (!trimmed || trimmed.length < 20) {
    return {
      ok: false,
      supportedModel: null,
      latencyMs: 0,
      error: "Key is too short to be valid",
      errorCode: "INVALID_KEY",
    };
  }

  const client = new GoogleGenAI({ apiKey: trimmed });

  // Try flash first (most permissive free tier), then lite
  const modelsToTry: GeminiModel[] = ["gemini-2.5-flash", "gemini-2.0-flash-lite"];

  for (const model of modelsToTry) {
    const start = Date.now();
    try {
      await client.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: TEST_PROMPT }] }],
        config: TEST_CONFIG,
      });
      return { ok: true, supportedModel: model, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string };
      const msg = anyErr?.message ?? String(err);
      const status = anyErr?.status;
      const latencyMs = Date.now() - start;

      // Invalid key — hard fail, no point trying other models
      if (
        status === 400 &&
        (msg.includes("API_KEY_INVALID") || msg.includes("API key not valid") || msg.includes("INVALID_ARGUMENT"))
      ) {
        return {
          ok: false,
          supportedModel: null,
          latencyMs,
          error: "API key is not valid or has been revoked",
          errorCode: "INVALID_KEY",
        };
      }

      // Quota exceeded — key IS valid, just out of credits
      if (status === 429) {
        return {
          ok: true,
          supportedModel: model,
          latencyMs,
          error: "Key is valid but quota is exceeded",
          errorCode: "QUOTA_EXCEEDED",
        };
      }

      // Model not available on this key — try next
      if (status === 404 || status === 403) {
        continue;
      }

      // Network / server errors — report unknown
      return {
        ok: false,
        supportedModel: null,
        latencyMs,
        error: `Could not reach Gemini API: ${msg.slice(0, 120)}`,
        errorCode: "NETWORK_ERROR",
      };
    }
  }

  return {
    ok: false,
    supportedModel: null,
    latencyMs: 0,
    error: "No supported model found for this key",
    errorCode: "MODEL_NOT_SUPPORTED",
  };
}
