import { GoogleGenAI } from "@google/genai";

const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "placeholder";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const configuredModel = process.env.GEMINI_MODEL?.trim().replace(/^models\//, "");

/**
 * One server-side model setting for all text, OCR, detection, and localization
 * requests. Retired model values are deliberately ignored so an old workspace
 * environment cannot resurrect the known 404 failure.
 */
export const GEMINI_MODEL =
  configuredModel &&
  (/^gemini-2\.5-/i.test(configuredModel) || configuredModel === "gemini-flash-lite-latest")
    ? configuredModel
    : DEFAULT_GEMINI_MODEL;

/** Current multimodal fallback for projects where the primary model is unavailable. */
export const GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";
export const GEMINI_MODEL_CANDIDATES = Array.from(
  new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL]),
);

export const GEMINI_MODEL_UNAVAILABLE_MESSAGE =
  "Gemini model unavailable. Check the configured Gemini model and API project.";

export function isGeminiModelUnavailable(error: unknown): boolean {
  const candidate = error as { status?: unknown; message?: unknown };
  const status = Number(candidate?.status);
  const message = typeof candidate?.message === "string"
    ? candidate.message
    : String(error);

  return status === 404 ||
    /model(?:s)?\/?.*(?:not found|not available|unavailable|does not exist|no longer available)/i.test(message) ||
    /(?:not found|not available|unavailable|does not exist|no longer available).*model/i.test(message);
}

export const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    apiVersion: "",
    baseUrl,
  },
});

export function createUserGeminiClient(userApiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey: userApiKey });
}
