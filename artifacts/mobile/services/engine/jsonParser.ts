/**
 * JsonParser — Safe JSON parsing utilities for source adapters.
 *
 * Provides typed accessors that return null/default instead of throwing,
 * so adapters can write clean parsing code without try/catch everywhere.
 */

export class JsonParser {
  /**
   * Parse a JSON string, returning null on failure instead of throwing.
   */
  static safe<T = Record<string, unknown>>(text: string): T | null {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /**
   * Get a string value from an object by trying multiple keys in order.
   * Returns null if none resolve to a non-empty string.
   */
  static str(obj: unknown, ...keys: string[]): string | null {
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  }

  /**
   * Get a number value from an object, trying multiple keys.
   * Returns null if none resolve to a finite number.
   */
  static num(obj: unknown, ...keys: string[]): number | null {
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "number" && isFinite(v)) return v;
      if (typeof v === "string") {
        const n = parseFloat(v);
        if (isFinite(n)) return n;
      }
    }
    return null;
  }

  /**
   * Get a boolean value from an object.
   * Returns the `defaultValue` if the key is absent.
   */
  static bool(obj: unknown, key: string, defaultValue = false): boolean {
    if (!obj || typeof obj !== "object") return defaultValue;
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    return defaultValue;
  }

  /**
   * Get a typed array from an object, returning [] if missing or not an array.
   */
  static arr<T = unknown>(obj: unknown, ...keys: string[]): T[] {
    if (!obj || typeof obj !== "object") return [];
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (Array.isArray(v)) return v as T[];
    }
    return [];
  }

  /**
   * Strip HTML tags from a string (for description fields that contain markup).
   */
  static stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").trim();
  }

  /**
   * Safely coerce a value to string. Returns `fallback` for null/undefined.
   */
  static coerceStr(v: unknown, fallback = ""): string {
    if (typeof v === "string") return v;
    if (v == null) return fallback;
    return String(v);
  }
}
