/**
 * DiskCache — Persistent file-system cache using expo-file-system.
 *
 * Equivalent to Mihon's DiskLruCache-backed ChapterCache.
 * Stores arbitrary blobs (images, JSON page lists) keyed by a
 * hashed identifier. Supports TTL-based and size-based eviction.
 *
 * Two sub-namespaces:
 *   "pages"   — chapter page URL lists (JSON, small)
 *   "images"  — downloaded image bytes (large, size-evicted)
 */

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const CACHE_DIR = `${FileSystem.cacheDirectory ?? ""}mv_cache/`;
const INDEX_FILE = `${CACHE_DIR}index.json`;
const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB

interface IndexEntry {
  key: string;
  file: string;
  sizeBytes: number;
  createdAt: number;
  ttlMs: number | null;
}

type CacheIndex = Record<string, IndexEntry>;

let _index: CacheIndex | null = null;
let _indexDirty = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function isNative(): boolean {
  return Platform.OS !== "web";
}

/** djb2 hash → base36 string (URL-safe filename) */
function hashKey(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
    hash = hash >>> 0; // unsigned
  }
  return hash.toString(36);
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function loadIndex(): Promise<CacheIndex> {
  if (_index !== null) return _index;
  try {
    const info = await FileSystem.getInfoAsync(INDEX_FILE);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(INDEX_FILE);
      _index = JSON.parse(raw) as CacheIndex;
      return _index;
    }
  } catch {}
  _index = {};
  return _index;
}

function scheduleSave(): void {
  _indexDirty = true;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!_indexDirty || !_index) return;
    try {
      await ensureDir();
      await FileSystem.writeAsStringAsync(INDEX_FILE, JSON.stringify(_index));
      _indexDirty = false;
    } catch {}
  }, 1500);
}

async function evictIfNeeded(): Promise<void> {
  if (!_index) return;
  const now = Date.now();

  // 1. Remove expired entries
  for (const [key, entry] of Object.entries(_index)) {
    if (entry.ttlMs !== null && now - entry.createdAt > entry.ttlMs) {
      try { await FileSystem.deleteAsync(entry.file, { idempotent: true }); } catch {}
      delete _index[key];
    }
  }

  // 2. Enforce total size limit (FIFO eviction, oldest first)
  const entries = Object.values(_index).sort((a, b) => a.createdAt - b.createdAt);
  let totalBytes = entries.reduce((s, e) => s + e.sizeBytes, 0);
  for (const entry of entries) {
    if (totalBytes <= MAX_CACHE_BYTES) break;
    try { await FileSystem.deleteAsync(entry.file, { idempotent: true }); } catch {}
    totalBytes -= entry.sizeBytes;
    delete _index[entry.key];
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export const DiskCache = {
  /**
   * Read a cached string value. Returns null on miss or expiry.
   */
  async get(namespace: string, key: string): Promise<string | null> {
    if (!isNative()) return null;
    const index = await loadIndex();
    const cacheKey = `${namespace}:${key}`;
    const entry = index[cacheKey];
    if (!entry) return null;
    if (entry.ttlMs !== null && Date.now() - entry.createdAt > entry.ttlMs) {
      try { await FileSystem.deleteAsync(entry.file, { idempotent: true }); } catch {}
      delete index[cacheKey];
      scheduleSave();
      return null;
    }
    try {
      const info = await FileSystem.getInfoAsync(entry.file);
      if (!info.exists) {
        delete index[cacheKey];
        scheduleSave();
        return null;
      }
      return await FileSystem.readAsStringAsync(entry.file);
    } catch {
      return null;
    }
  },

  /**
   * Write a string value to the cache.
   * @param ttlMs  Time-to-live in ms. null = no expiry.
   */
  async set(namespace: string, key: string, value: string, ttlMs: number | null = null): Promise<void> {
    if (!isNative()) return;
    await ensureDir();
    const index = await loadIndex();
    const cacheKey = `${namespace}:${key}`;
    const file = `${CACHE_DIR}${hashKey(cacheKey)}.cache`;

    try {
      await FileSystem.writeAsStringAsync(file, value);
      const info = await FileSystem.getInfoAsync(file);
      const sizeBytes = (info as FileSystem.FileInfo & { size?: number }).size ?? value.length;
      index[cacheKey] = { key: cacheKey, file, sizeBytes, createdAt: Date.now(), ttlMs };
      scheduleSave();
      await evictIfNeeded();
    } catch {}
  },

  /** Remove a cached entry. */
  async delete(namespace: string, key: string): Promise<void> {
    if (!isNative()) return;
    const index = await loadIndex();
    const cacheKey = `${namespace}:${key}`;
    const entry = index[cacheKey];
    if (entry) {
      try { await FileSystem.deleteAsync(entry.file, { idempotent: true }); } catch {}
      delete index[cacheKey];
      scheduleSave();
    }
  },

  /** Check if a valid (non-expired) entry exists. */
  async has(namespace: string, key: string): Promise<boolean> {
    if (!isNative()) return false;
    const index = await loadIndex();
    const cacheKey = `${namespace}:${key}`;
    const entry = index[cacheKey];
    if (!entry) return false;
    if (entry.ttlMs !== null && Date.now() - entry.createdAt > entry.ttlMs) return false;
    try {
      const info = await FileSystem.getInfoAsync(entry.file);
      return info.exists;
    } catch {
      return false;
    }
  },

  /** Remove all cached entries for a namespace. */
  async clearNamespace(namespace: string): Promise<void> {
    if (!isNative()) return;
    const index = await loadIndex();
    for (const [cacheKey, entry] of Object.entries(index)) {
      if (cacheKey.startsWith(`${namespace}:`)) {
        try { await FileSystem.deleteAsync(entry.file, { idempotent: true }); } catch {}
        delete index[cacheKey];
      }
    }
    scheduleSave();
  },

  /** Total size of cache in bytes. */
  async getSizeBytes(): Promise<number> {
    const index = await loadIndex();
    return Object.values(index).reduce((s, e) => s + e.sizeBytes, 0);
  },
};
