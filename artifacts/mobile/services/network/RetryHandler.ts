/**
 * RetryHandler — Configurable retry policies for network requests.
 *
 * Extracted from fetchClient.ts to be reusable across all network layers.
 * Supports exponential backoff, jitter, per-error-type strategies, and
 * abort signal integration (matches Mihon's OkHttp retry interceptor design).
 */

export type RetryableErrorType =
  | "network"
  | "rate_limit"
  | "upstream"
  | "timeout"
  | "cloudflare"
  | "auth"
  | "not_found"
  | "parse";

export interface RetryPolicy {
  /** Maximum number of attempts (default: 3). Includes the initial attempt. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2.0) */
  backoffFactor?: number;
  /** Add ±30% jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
  /** Error types that should NOT be retried (default: cloudflare, auth, not_found) */
  noRetryOn?: RetryableErrorType[];
  /** Called before each retry with the current attempt number and delay */
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
}

const DEFAULT_NO_RETRY: RetryableErrorType[] = ["cloudflare", "auth", "not_found"];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  backoffFactor: number,
  jitter: boolean
): number {
  const exp = Math.min(baseDelayMs * Math.pow(backoffFactor, attempt - 1), maxDelayMs);
  if (!jitter) return exp;
  // ±30% jitter
  const spread = exp * 0.3;
  return Math.floor(exp - spread + Math.random() * spread * 2);
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly type: RetryableErrorType,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * Executes `fn` with automatic retry according to `policy`.
 * Throws the last error if all attempts fail.
 *
 * @param fn        - Async function to retry. Should throw RetryableError for typed errors.
 * @param policy    - Retry configuration.
 * @param signal    - AbortSignal to cancel retries early.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy = {},
  signal?: AbortSignal,
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2.0,
    jitter = true,
    noRetryOn = DEFAULT_NO_RETRY,
    onRetry,
  } = policy;

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Never retry certain error types
      if (err instanceof RetryableError && noRetryOn.includes(err.type)) {
        throw err;
      }

      // Don't retry on the last attempt
      if (attempt >= maxAttempts) break;

      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs, backoffFactor, jitter);
      onRetry?.(attempt, delayMs, lastError);

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Classify an HTTP status code into a RetryableErrorType.
 */
export function classifyHttpStatus(status: number, bodySnippet = ""): RetryableErrorType {
  if (status === 429) return "rate_limit";
  if (status === 404) return "not_found";
  if (status === 401) return "auth";
  if (status === 403 || status === 503) {
    const cfSignals = ["cloudflare_challenge", "cf_clearance", "cf-ray", "just a moment", "checking your browser"];
    if (cfSignals.some((s) => bodySnippet.toLowerCase().includes(s))) return "cloudflare";
    return status === 403 ? "auth" : "upstream";
  }
  if (status >= 500) return "upstream";
  return "network";
}

/**
 * Determines if an error type is worth retrying.
 */
export function isRetryable(type: RetryableErrorType): boolean {
  return !DEFAULT_NO_RETRY.includes(type);
}
