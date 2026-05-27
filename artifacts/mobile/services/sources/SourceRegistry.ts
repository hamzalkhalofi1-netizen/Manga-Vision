/**
 * SourceRegistry — Central registry for all manga source adapters.
 *
 * Mihon equivalent: SourceManager.kt — manages source registration,
 * lookup, capability flags, and metadata. Extends the existing simple
 * ALL_SOURCES array with proper metadata, lazy initialization, and
 * per-source capability advertisement.
 *
 * Usage:
 *   SourceRegistry.register(mangadexSource, { language: "en", nsfw: false });
 *   const source = SourceRegistry.get("mangadex");
 *   const allEnabled = SourceRegistry.getEnabled();
 */

import { MangaSource } from "./types";

export interface SourceMetadata {
  /** BCP-47 language code(s). Can be an array for multi-language sources. */
  language: string | string[];
  /** Whether source contains adult/NSFW content */
  nsfw: boolean;
  /** Whether source requires WebView-based CF verification */
  requiresVerification: boolean;
  /** Whether source is currently enabled */
  isEnabled: boolean;
  /** Optional icon URL for display in source list */
  iconUrl?: string;
  /** Version string for the source adapter */
  version?: string;
  /** Homepage URL */
  websiteUrl?: string;
  /** Whether this source uses an official API (vs. scraping) */
  hasOfficialApi?: boolean;
  /** Whether this source requires a user login */
  requiresLogin?: boolean;
  /** Tags describing the source (e.g. "webtoon", "manhwa", "official") */
  tags?: string[];
}

export interface RegisteredSource {
  source: MangaSource;
  meta: SourceMetadata;
}

class SourceRegistryClass {
  private readonly registry = new Map<string, RegisteredSource>();
  private readonly order: string[] = [];

  /**
   * Register a source with its metadata.
   * If the source was already registered, updates metadata only.
   */
  register(source: MangaSource, meta: Partial<SourceMetadata> = {}): void {
    const fullMeta: SourceMetadata = {
      language: meta.language ?? "en",
      nsfw: meta.nsfw ?? false,
      requiresVerification: meta.requiresVerification ?? source.requiresVerification ?? false,
      isEnabled: meta.isEnabled ?? source.isEnabled ?? true,
      iconUrl: meta.iconUrl,
      version: meta.version ?? "1.0.0",
      websiteUrl: meta.websiteUrl ?? source.baseUrl,
      hasOfficialApi: meta.hasOfficialApi ?? false,
      requiresLogin: meta.requiresLogin ?? false,
      tags: meta.tags ?? [],
    };
    if (!this.registry.has(source.id)) {
      this.order.push(source.id);
    }
    this.registry.set(source.id, { source, meta: fullMeta });
  }

  /**
   * Register multiple sources at once.
   */
  registerAll(
    entries: Array<{ source: MangaSource; meta?: Partial<SourceMetadata> }>,
  ): void {
    for (const { source, meta } of entries) {
      this.register(source, meta);
    }
  }

  /**
   * Look up a source by ID. Returns null if not found.
   */
  get(id: string): MangaSource | null {
    return this.registry.get(id)?.source ?? null;
  }

  /**
   * Get a source or throw if not found.
   */
  getOrThrow(id: string): MangaSource {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Source not found: ${id}`);
    return entry.source;
  }

  /**
   * Get registered metadata for a source.
   */
  getMeta(id: string): SourceMetadata | null {
    return this.registry.get(id)?.meta ?? null;
  }

  /**
   * Get all registered sources in registration order.
   */
  getAll(): MangaSource[] {
    return this.order.map((id) => this.registry.get(id)!.source);
  }

  /**
   * Get all currently enabled sources.
   */
  getEnabled(): MangaSource[] {
    return this.order
      .map((id) => this.registry.get(id)!)
      .filter((e) => e.meta.isEnabled)
      .map((e) => e.source);
  }

  /**
   * Get sources filtered by language.
   */
  getByLanguage(lang: string): MangaSource[] {
    return this.order
      .map((id) => this.registry.get(id)!)
      .filter((e) => {
        const l = e.meta.language;
        return Array.isArray(l) ? l.includes(lang) : l === lang;
      })
      .map((e) => e.source);
  }

  /**
   * Get sources that require Cloudflare verification.
   */
  getRequiringVerification(): MangaSource[] {
    return this.order
      .map((id) => this.registry.get(id)!)
      .filter((e) => e.meta.requiresVerification)
      .map((e) => e.source);
  }

  /**
   * Check if a source is registered.
   */
  has(id: string): boolean {
    return this.registry.has(id);
  }

  /**
   * Enable or disable a source at runtime.
   */
  setEnabled(id: string, enabled: boolean): void {
    const entry = this.registry.get(id);
    if (entry) {
      entry.meta.isEnabled = enabled;
      entry.source.isEnabled = enabled;
    }
  }

  /**
   * Get source capability flags for UI display.
   */
  getCapabilities(id: string): {
    search: boolean;
    trending: boolean;
    latestUpdates: boolean;
    requiresVerification: boolean;
    hasOfficialApi: boolean;
    nsfw: boolean;
    language: string | string[];
  } {
    const entry = this.registry.get(id);
    if (!entry) {
      return {
        search: false,
        trending: false,
        latestUpdates: false,
        requiresVerification: false,
        hasOfficialApi: false,
        nsfw: false,
        language: "en",
      };
    }
    return {
      search: typeof entry.source.search === "function",
      trending: typeof entry.source.getTrending === "function",
      latestUpdates: typeof entry.source.getLatestUpdates === "function",
      requiresVerification: entry.meta.requiresVerification,
      hasOfficialApi: entry.meta.hasOfficialApi ?? false,
      nsfw: entry.meta.nsfw,
      language: entry.meta.language,
    };
  }

  /**
   * Get all registered source IDs in order.
   */
  getIds(): string[] {
    return [...this.order];
  }

  /**
   * Get count of registered sources.
   */
  get count(): number {
    return this.registry.size;
  }

  /**
   * Unregister a source (useful for testing or dynamic unloading).
   */
  unregister(id: string): void {
    this.registry.delete(id);
    const idx = this.order.indexOf(id);
    if (idx >= 0) this.order.splice(idx, 1);
  }
}

export const SourceRegistry = new SourceRegistryClass();
