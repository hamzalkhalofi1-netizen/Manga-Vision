/**
 * SourceError — Unified error type for all source adapters.
 *
 * Replaces the scattered error handling across individual sources.
 * Every adapter surfaces exactly this type; the UI layers inspect
 * `type` to decide how to present the failure to the user.
 */

export type SourceErrorType =
  | "cloudflare"   // Cloudflare JS challenge blocking access
  | "rate_limit"   // HTTP 429 — back off and retry later
  | "network"      // Timeout, DNS failure, unreachable
  | "parse"        // Response was not parseable (bad JSON, empty HTML)
  | "not_found"    // HTTP 404 — resource doesn't exist
  | "auth"         // HTTP 401/403 — session or credentials required
  | "upstream";    // HTTP 5xx — source server error

export class SourceError extends Error {
  readonly type: SourceErrorType;
  readonly statusCode?: number;
  readonly sourceId?: string;

  constructor(
    message: string,
    type: SourceErrorType,
    statusCode?: number,
    sourceId?: string,
  ) {
    super(message);
    this.name = "SourceError";
    this.type = type;
    this.statusCode = statusCode;
    this.sourceId = sourceId;
  }

  /** True for errors that may resolve on retry (network, upstream, rate_limit). */
  get isTransient(): boolean {
    return this.type === "network" || this.type === "upstream" || this.type === "rate_limit";
  }

  /** True for errors that require user action (cloudflare, auth). */
  get requiresUserAction(): boolean {
    return this.type === "cloudflare" || this.type === "auth";
  }
}
