export {
  ai,
  createUserGeminiClient,
  GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL,
  GEMINI_MODEL_CANDIDATES,
  GEMINI_MODEL_UNAVAILABLE_MESSAGE,
  isGeminiModelUnavailable,
} from "./client";
export { generateImage } from "./image";
export { batchProcess, batchProcessWithSSE, isRateLimitError, type BatchOptions } from "./batch";
