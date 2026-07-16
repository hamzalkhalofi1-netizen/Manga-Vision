/**
 * HtmlParser — Shared HTML parsing utilities for source adapters.
 *
 * Covers every pattern that appears across manga scrapers:
 *   - HTML entity decoding (including numeric forms)
 *   - Cloudflare challenge detection
 *   - Astro v5 island prop extraction & unpacking
 *   - Next.js __NEXT_DATA__ extraction
 *   - <meta> tag extraction
 *   - Image URL collection (CDN patterns, img elements)
 *   - Structured data (JSON-LD) extraction
 *
 * All methods are static — no state, safe to use from any adapter.
 */

export class HtmlParser {
  // ── Entity decoding ─────────────────────────────────────────────────────────

  /**
   * Decode common HTML entities including numeric character references.
   * Safe to call multiple times (idempotent for plain text).
   */
  static decodeEntities(s: string): string {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#38;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }

  /** Strip all HTML tags from a string. */
  static stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, "").trim();
  }

  // ── Cloudflare detection ────────────────────────────────────────────────────

  /**
   * Returns true when the HTML is a Cloudflare JS challenge or captcha page
   * rather than real content.
   */
  static isCloudflare(html: string): boolean {
    return /just a moment|checking your browser|cf-browser-verification|challenge-form|challenge-running|attention required/i.test(html);
  }

  // ── Meta tag extraction ─────────────────────────────────────────────────────

  /**
   * Extract the `content` attribute of a `<meta>` tag matched by name or property.
   * Tries both attribute orderings (name before content, content before name).
   */
  static extractMeta(html: string, nameOrProp: string): string | null {
    const escaped = nameOrProp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fwd = new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const rev = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
      "i",
    );
    return html.match(fwd)?.[1] ?? html.match(rev)?.[1] ?? null;
  }

  // ── Next.js data ────────────────────────────────────────────────────────────

  /**
   * Extract the parsed JSON from a Next.js `__NEXT_DATA__` script tag.
   * Returns null if the tag is absent or the JSON is invalid.
   */
  static extractNextData(html: string): Record<string, unknown> | null {
    const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) return null;
    try {
      return JSON.parse(m[1]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ── Astro v5 island props ───────────────────────────────────────────────────

  /**
   * Extract and decode all `<astro-island props="...">` attribute values from
   * the page. Returns the decoded JSON objects for every island.
   *
   * @param html            - Raw HTML (entities NOT yet decoded)
   * @param componentExport - Optional filter: only return islands whose
   *                          `component-export` attribute matches this string.
   */
  static extractAstroIslands(
    html: string,
    componentExport?: string,
  ): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const islandRe = /<astro-island([^>]+)>/g;
    let m: RegExpExecArray | null;

    while ((m = islandRe.exec(html)) !== null) {
      const attrs = m[1];
      // Filter by component-export if requested
      if (componentExport) {
        const expMatch = attrs.match(/component-export=["']([^"']+)["']/);
        if (!expMatch || expMatch[1] !== componentExport) continue;
      }
      const propsMatch = attrs.match(/props=["']([^"']+)["']/);
      if (!propsMatch) continue;
      try {
        const decoded = HtmlParser.decodeEntities(propsMatch[1]);
        results.push(JSON.parse(decoded) as Record<string, unknown>);
      } catch {
        // skip malformed island
      }
    }

    return results;
  }

  /**
   * Unpack an Astro v5 serialized value.
   *
   * Astro serializes props as tagged arrays: `[typeTag, value]` where:
   *   - `[0, x]` → scalar value x
   *   - `[1, [...]]` → array
   *   - Other tags (2–11) are less common (RegExp, Date, Map, Set, BigInt…)
   *
   * This function recursively unwraps any nested tagged values.
   */
  static unpackAstro(v: unknown): unknown {
    if (!Array.isArray(v)) return v;

    // Tagged pair: [typeTag, value]
    if (
      v.length === 2 &&
      typeof v[0] === "number" &&
      v[0] >= 0 &&
      v[0] <= 11
    ) {
      const [tag, inner] = v;
      if (tag === 1 && Array.isArray(inner)) {
        return (inner as unknown[]).map(HtmlParser.unpackAstro);
      }
      return HtmlParser.unpackAstro(inner);
    }

    // Plain array — unwrap each element
    return (v as unknown[]).map(HtmlParser.unpackAstro);
  }

  /**
   * Deep-unpack a full Astro island props object.
   * All tagged-array leaves are replaced by their unwrapped values.
   */
  static unpackAstroProps(props: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      result[k] = HtmlParser.unpackAstro(v);
    }
    return result;
  }

  // ── Image URL extraction ────────────────────────────────────────────────────

  /**
   * Collect all image URLs in `html` that match at least one of `patterns`.
   * If no patterns are supplied, a broad CDN/image default is used.
   * Deduplicates and returns URLs in document order.
   */
  static extractImageUrls(html: string, patterns?: RegExp[]): string[] {
    const decoded = HtmlParser.decodeEntities(html);
    const defaultPatterns: RegExp[] = [
      // img src / data-src attributes
      /(?:src|data-src)=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)(?:\?[^"']*)?)/gi,
      // Bare https URLs ending with an image extension
      /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?\b/gi,
    ];
    const active = patterns ?? defaultPatterns;
    const seen = new Set<string>();
    const urls: string[] = [];

    for (const pat of active) {
      // Reset lastIndex for global patterns
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(decoded)) !== null) {
        const url = m[1] ?? m[0];
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      }
    }

    return urls;
  }

  // ── JSON-LD structured data ─────────────────────────────────────────────────

  /**
   * Extract all JSON-LD script blobs from the page and return them parsed.
   */
  static extractJsonLd(html: string): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        results.push(JSON.parse(m[1]) as Record<string, unknown>);
      } catch {
        // skip invalid
      }
    }
    return results;
  }

  // ── Misc ────────────────────────────────────────────────────────────────────

  /**
   * Safely navigate a nested object by dot-path.
   * Returns `undefined` when any segment is missing or not an object.
   */
  static deepGet(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }

  /**
   * Parse a date string (ISO 8601, relative "N unit ago", slash-delimited)
   * into a Unix millisecond timestamp.
   */
  static parseDate(raw: string): number {
    if (!raw) return Date.now();
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.getTime();
    const lower = raw.toLowerCase().trim();
    const rel = lower.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
    if (rel) {
      const n = parseInt(rel[1], 10);
      const ms: Record<string, number> = {
        second: 1_000, minute: 60_000, hour: 3_600_000,
        day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
      };
      return Date.now() - n * (ms[rel[2]] ?? 0);
    }
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (slash) {
      const year = slash[3].length === 2 ? 2000 + parseInt(slash[3], 10) : parseInt(slash[3], 10);
      return new Date(year, parseInt(slash[1], 10) - 1, parseInt(slash[2], 10)).getTime();
    }
    return Date.now();
  }

  /** Normalize manga status strings into the canonical set. */
  static parseMangaStatus(raw: string): "ongoing" | "completed" | "hiatus" | "cancelled" | undefined {
    const s = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (/ongoing|publishing|releasing|active/.test(s)) return "ongoing";
    if (/completed|finished|complete/.test(s)) return "completed";
    if (/hiatus|onhold|paused/.test(s)) return "hiatus";
    if (/cancelled|canceled|dropped|discontinued/.test(s)) return "cancelled";
    return undefined;
  }
}
