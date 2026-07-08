/**
 * ImageDiskCache — Persistent, byte-level LRU cache for manga page images.
 *
 * Unlike the generic string-based DiskCache, this cache stores raw image
 * bytes directly on disk (via FileSystem.downloadAsync) so large chapter
 * pages never pass through JS-string/base64 memory. It is used by both
 * ReaderPreloader (ahead/behind preloading) and MangaPage (on-demand /
 * current-page loading) so every downloaded page is cached exactly once
 * and reused instantly on revisit.
 *
 * Guarantees:
 *   - Cache persists across app launches (files live in cacheDirectory).
 *   - True LRU: every read/write touches `lastAccessed`; eviction always
 *     removes the least-recently-used entries first once the configured
 *     byte budget (default 3GB, configurable 2-5GB) is exceeded.
 *   - Corruption-safe: entries are validated (file exists, non-zero size)
 *     before being reported as cache hits; `invalidate()` lets callers
 *     drop a bad entry and force a clean re-download.
 *   - Global concurrency limiter: at most N (default 4) downloads run at
 *     once no matter how many callers request images simultaneously.
 *   - De-duplicates concurrent requests for the same URL — only one
 *     network download happens even if multiple components ask for it.
 */

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const CACHE_DIR = `${FileSystem.cacheDirectory ?? ""}mv_image_cache/`;
const INDEX_FILE = `${CACHE_DIR}index.json`;

const DEFAULT_MAX_BYTES = 3 * 1024 * 1024 * 1024; // 3GB — within the 2-5GB configurable range
const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 4; // within the 3-5 concurrency requirement

interface ImageIndexEntry {
  file: string;
  sizeBytes: number;
  createdAt: number;
  lastAccessed: number;
}

type ImageIndex = Record<string, ImageIndexEntry>;

let _index: ImageIndex | null = null;
let _indexDirty = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

let _maxBytes = DEFAULT_MAX_BYTES;
let _maxConcurrent = DEFAULT_MAX_CONCURRENT_DOWNLOADS;

// ── Concurrency gate ─────────────────────────────────────────────────────────
let _activeDownloads = 0;
const _waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (_activeDownloads < _maxConcurrent) {
    _activeDownloads++;
    return;
  }
  await new Promise<void>((resolve) => _waiters.push(resolve));
  _activeDownloads++;
}

function releaseSlot(): void {
  _activeDownloads--;
  const next = _waiters.shift();
  if (next) next();
}

// ── In-flight de-duplication ─────────────────────────────────────────────────
const _inFlight = new Map<string, Promise<string>>();

function isNative(): boolean {
  return Platform.OS !== "web";
}

/** djb2 hash → base36 string (URL-safe filename), shared scheme with DiskCache. */
function hashKey(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(36);
}

function guessExtension(url: string): string {
  const m = /\.(jpe?g|png|webp|gif|bmp|avif)(?:[?#]|$)/i.exec(url);
  return m ? `.${m[1].toLowerCase()}` : ".img";
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

async function loadIndex(): Promise<ImageIndex> {
  if (_index !== null) return _index;
  try {
    const info = await FileSystem.getInfoAsync(INDEX_FILE);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(INDEX_FILE);
      _index = JSON.parse(raw) as ImageIndex;
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
  }, 1000);
}

/** Enforce the byte budget by evicting least-recently-used entries first. */
async function evictIfNeeded(): Promise<void> {
  if (!_index) return;
  const entries = Object.entries(_index);
  let totalBytes = entries.reduce((s, [, e]) => s + e.sizeBytes, 0);
  if (totalBytes <= _maxBytes) return;

  // Oldest-accessed first = true LRU eviction order.
  const sorted = entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  for (const [key, entry] of sorted) {
    if (totalBytes <= _maxBytes) break;
    try {
      await FileSystem.deleteAsync(entry.file, { idempotent: true });
    } catch {}
    totalBytes -= entry.sizeBytes;
    delete _index[key];
  }
  scheduleSave();
}

export const ImageDiskCache = {
  /** Configure the LRU byte budget (recommended range: 2GB–5GB). */
  setMaxBytes(bytes: number): void {
    _maxBytes = bytes;
  },
  getMaxBytes(): number {
    return _maxBytes;
  },

  /** Configure the max number of simultaneous downloads (recommended: 3-5). */
  setMaxConcurrentDownloads(n: number): void {
    _maxConcurrent = Math.max(1, n);
  },

  /**
   * Look up a valid cached copy of `url`. Returns a local `file://` URI on a
   * hit (and refreshes its LRU timestamp), or `null` on a miss/corruption.
   */
  async getPath(url: string): Promise<string | null> {
    if (!isNative()) return null;
    const index = await loadIndex();
    const key = hashKey(url);
    const entry = index[key];
    if (!entry) return null;

    try {
      const info = await FileSystem.getInfoAsync(entry.file, { size: true } as any);
      const size = (info as FileSystem.FileInfo & { size?: number }).size ?? 0;
      if (!info.exists || size === 0) {
        // Missing or corrupted (zero-byte) — drop the stale entry.
        delete index[key];
        scheduleSave();
        return null;
      }
      entry.lastAccessed = Date.now();
      scheduleSave();
      return entry.file;
    } catch {
      return null;
    }
  },

  /** Drop a (possibly corrupted) cache entry so the next call re-downloads it. */
  async invalidate(url: string): Promise<void> {
    if (!isNative()) return;
    const index = await loadIndex();
    const key = hashKey(url);
    const entry = index[key];
    if (entry) {
      try {
        await FileSystem.deleteAsync(entry.file, { idempotent: true });
      } catch {}
      delete index[key];
      scheduleSave();
    }
  },

  /**
   * Download `url` (honouring the global concurrency limit) and persist it
   * to disk, returning the local `file://` URI. Concurrent calls for the
   * same URL share a single in-flight download.
   *
   * @param forceIndependent — When true, bypass the _inFlight de-duplication and
   *   start a completely independent download. Use this when a previous download
   *   attached to the shared _inFlight promise was aborted by someone else's
   *   AbortSignal (e.g. ReaderPreloader aborting its own download) and we need
   *   a guaranteed non-abortable retry. Default is false.
   */
  async download(
    url: string,
    headers?: Record<string, string>,
    signal?: AbortSignal,
    forceIndependent = false
  ): Promise<string> {
    if (!isNative()) throw new Error("ImageDiskCache is unavailable on web");

    if (!forceIndependent) {
      const existing = _inFlight.get(url);
      if (existing) return existing;
    }

    const task = (async () => {
      await acquireSlot();
      try {
        if (signal?.aborted) {
          const err = new Error("Download aborted");
          err.name = "AbortError";
          throw err;
        }

        await ensureDir();
        const key = hashKey(url);
        const ext = guessExtension(url);
        const tmpFile = `${CACHE_DIR}${key}.tmp${ext}`;
        const finalFile = `${CACHE_DIR}${key}${ext}`;

        const resumable = FileSystem.createDownloadResumable(url, tmpFile, {
          headers,
        });

        let aborted = false;
        const onAbort = () => {
          aborted = true;
          resumable.cancelAsync().catch(() => {});
        };
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        let result;
        try {
          result = await resumable.downloadAsync();
        } finally {
          if (signal) signal.removeEventListener("abort", onAbort);
        }

        if (aborted || !result) {
          try {
            await FileSystem.deleteAsync(tmpFile, { idempotent: true });
          } catch {}
          const err = new Error("Download aborted");
          err.name = "AbortError";
          throw err;
        }

        if (result.status < 200 || result.status >= 300) {
          try {
            await FileSystem.deleteAsync(tmpFile, { idempotent: true });
          } catch {}
          throw new Error(`Image download failed: HTTP ${result.status}`);
        }

        const info = await FileSystem.getInfoAsync(tmpFile, { size: true } as any);
        const sizeBytes = (info as FileSystem.FileInfo & { size?: number }).size ?? 0;
        if (!info.exists || sizeBytes === 0) {
          try {
            await FileSystem.deleteAsync(tmpFile, { idempotent: true });
          } catch {}
          throw new Error("Downloaded image is empty or corrupted");
        }

        try {
          await FileSystem.deleteAsync(finalFile, { idempotent: true });
        } catch {}
        await FileSystem.moveAsync({ from: tmpFile, to: finalFile });

        const index = await loadIndex();
        index[key] = {
          file: finalFile,
          sizeBytes,
          createdAt: Date.now(),
          lastAccessed: Date.now(),
        };
        scheduleSave();
        await evictIfNeeded();

        return finalFile;
      } finally {
        releaseSlot();
      }
    })();

    // Only register in _inFlight when this is a normal shared download
    // (not a forceIndependent retry). If forceIndependent, we must NOT
    // overwrite an active preloader task already in the map.
    if (!forceIndependent) {
      _inFlight.set(url, task);
      try {
        return await task;
      } finally {
        _inFlight.delete(url);
      }
    }
    return task;
  },

  /** Total size of all cached image bytes. */
  async getSizeBytes(): Promise<number> {
    const index = await loadIndex();
    return Object.values(index).reduce((s, e) => s + e.sizeBytes, 0);
  },

  /** Remove every cached image (e.g. user-triggered "clear image cache"). */
  async clearAll(): Promise<void> {
    if (!isNative()) return;
    const index = await loadIndex();
    for (const entry of Object.values(index)) {
      try {
        await FileSystem.deleteAsync(entry.file, { idempotent: true });
      } catch {}
    }
    _index = {};
    scheduleSave();
  },
};
