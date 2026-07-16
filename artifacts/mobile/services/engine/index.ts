/**
 * Source Engine — Public API
 *
 * Import from here in adapter files. Never import engine internals directly.
 *
 * Usage:
 *   import { BaseAdapter, EngineHttpClient, HtmlParser, SourceError } from "@/services/engine";
 */

export { BaseAdapter } from "./BaseAdapter";
export { EngineHttpClient, ENGINE_BROWSER_UA } from "./httpClient";
export type { HttpClientConfig, GetOptions } from "./httpClient";
export { HtmlParser } from "./htmlParser";
export { JsonParser } from "./jsonParser";
export { EngineMemoryCache } from "./memoryCache";
export { ImageLoader } from "./imageLoader";
export type { ImageHeaders } from "./imageLoader";
export { SourceLogger } from "./logger";
export { SourceError } from "./errors";
export type { SourceErrorType } from "./errors";
