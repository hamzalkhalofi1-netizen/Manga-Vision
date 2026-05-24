import AsyncStorage from "@react-native-async-storage/async-storage";
import { callInpaintServer } from "./inpaintClient";

export interface TextRegion {
  original: string;
  translated: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  bgColor: string;
  textColor: string;
  speaker: string | null;
  emphasis: boolean;
}

export interface QueueProgress {
  total: number;
  completed: number;
  failed: number;
  currentIndex: number | null;
  isRunning: boolean;
  isCancelled: boolean;
  percentDone: number;
}

export type OnPageTranslated = (
  pageIndex: number,
  regions: TextRegion[],
  summary: string
) => void;

export type OnProgressUpdate = (progress: QueueProgress) => void;

interface QueueParams {
  pages: string[];
  targetLanguage: string;
  apiBase: string;
  userApiKey?: string | null;
  inpaintServerUrl?: string | null;
  onPageTranslated: OnPageTranslated;
  onProgress: OnProgressUpdate;
  onComplete: (stats: { completed: number; failed: number }) => void;
  onRateLimited?: () => void;
  onPageError?: (pageIndex: number, errorMessage: string) => void;
}

const DELAY_BETWEEN_MS = 1500;
const MAX_RETRIES = 2;
const PAGE_TIMEOUT_MS = 60_000;

// ── Persistent page translation cache ─────────────────────────────────────────
//
// Two-layer cache:
//   1. In-memory Map<string, CachedPage> for instant lookups this session
//   2. AsyncStorage persistence so translations survive app restarts
//
// Keyed by `${pageUrl}|${targetLanguage}`.
// Max 60 entries stored (FIFO eviction on the stored list).

interface CachedPage {
  regions: TextRegion[];
  summary: string;
}

const CACHE_STORAGE_KEY = "@mangaverse_tc_v2";
const CACHE_MAX_STORED  = 60;

const pageCache = new Map<string, CachedPage>();

let _cacheHydrated = false;
let _hydratePromise: Promise<void> | null = null;

/** Load stored translations into the in-memory cache (called once on first use). */
async function hydrateCache(): Promise<void> {
  if (_cacheHydrated) return;
  if (_hydratePromise) return _hydratePromise;

  _hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
      if (raw) {
        const entries: Array<[string, CachedPage]> = JSON.parse(raw);
        for (const [key, value] of entries) {
          if (!pageCache.has(key)) {
            pageCache.set(key, value);
          }
        }
      }
    } catch {}
    _cacheHydrated = true;
  })();

  return _hydratePromise;
}

// Debounced write — batches rapid cache updates into a single AsyncStorage write.
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      // Keep only the newest CACHE_MAX_STORED entries (oldest-first insertion order)
      const entries = Array.from(pageCache.entries()).slice(-CACHE_MAX_STORED);
      await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries));
    } catch {}
  }, 2000);
}

function cacheKey(url: string, lang: string): string {
  return `${url}|${lang}`;
}

/** Clear all cached translations — both in-memory and on disk. */
export async function clearTranslationCache(): Promise<void> {
  pageCache.clear();
  _cacheHydrated = false;
  _hydratePromise = null;
  try {
    await AsyncStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {}
}

/** Return the number of entries currently in the in-memory cache. */
export function getTranslationCacheSize(): number {
  return pageCache.size;
}

// ── Queue ──────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    fetch(url, options).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

class TranslationQueueManager {
  private abortController: AbortController | null = null;
  private _isRunning = false;

  get isRunning() {
    return this._isRunning;
  }

  async start(params: QueueParams): Promise<void> {
    if (this._isRunning) return;

    this.abortController = new AbortController();
    this._isRunning = true;

    const {
      pages,
      targetLanguage,
      apiBase,
      userApiKey,
      inpaintServerUrl,
      onPageTranslated,
      onProgress,
      onComplete,
      onRateLimited,
      onPageError,
    } = params;

    let completed = 0;
    let failed = 0;

    // Ensure the persistent cache is hydrated before the queue starts
    await hydrateCache();

    const emit = (currentIndex: number | null) => {
      onProgress({
        total: pages.length,
        completed,
        failed,
        currentIndex,
        isRunning: true,
        isCancelled: this.abortController?.signal.aborted ?? false,
        percentDone: Math.round(((completed + failed) / pages.length) * 100),
      });
    };

    emit(null);

    // ── Strict sequential loop — one page fully awaited before the next ────────
    for (let i = 0; i < pages.length; i++) {
      if (this.abortController.signal.aborted) break;

      emit(i);

      const pageUrl = pages[i];
      let success = false;

      // ── Cache hit — serve instantly, no network call ───────────────────────
      const key = cacheKey(pageUrl, targetLanguage);
      const cached = pageCache.get(key);
      if (cached) {
        onPageTranslated(i, cached.regions, cached.summary);
        success = true;
        completed++;
        // No delay — no API call was made
        continue;
      }

      for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
        if (this.abortController.signal.aborted) break;

        try {
          // ── Decentralized HF inpaint server path ──────────────────────────
          if (inpaintServerUrl) {
            const result = await callInpaintServer(inpaintServerUrl, pageUrl, [], PAGE_TIMEOUT_MS);
            pageCache.set(key, { regions: result.regions, summary: result.summary });
            scheduleSave();
            onPageTranslated(i, result.regions, result.summary);
            success = true;
            completed++;
            continue;
          }

          // ── Default local API path ─────────────────────────────────────────
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (userApiKey) headers["X-Gemini-Key"] = userApiKey;

          const res = await fetchWithTimeout(
            `${apiBase}/api/translate-image`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                imageUrl: pageUrl,
                targetLanguage,
              }),
            },
            PAGE_TIMEOUT_MS
          );

          if (res.status === 401) {
            let keyErrDetail = "Your Gemini API key is not valid. Open Settings → AI Keys and add a working key.";
            try {
              const body = await res.json();
              if (body?.error) keyErrDetail = body.error;
            } catch {}
            this.abortController?.abort();
            onPageError?.(i, keyErrDetail);
            break;
          }

          if (res.status === 429) {
            onRateLimited?.();
            this.abortController?.abort();
            break;
          }

          if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
              const body = await res.json();
              if (body?.error) detail = `${detail}: ${body.error}`;
            } catch {}
            throw new Error(detail);
          }

          const data = await res.json();

          const regions: TextRegion[] = data.regions?.length > 0 ? data.regions : [];
          const summary: string = data.summary ?? "";

          // Persist to in-memory cache and schedule a disk save
          pageCache.set(key, { regions, summary });
          scheduleSave();

          onPageTranslated(i, regions, summary);
          success = true;
          completed++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[TranslationQueue] Page ${i} attempt ${attempt + 1} failed: ${errMsg}`);
          if (attempt < MAX_RETRIES - 1) {
            await sleep(1500 * (attempt + 1));
          } else {
            failed++;
            onPageError?.(i, errMsg);
          }
        }
      }

      // Inter-page delay to avoid Gemini RESOURCE_EXHAUSTED
      if (!this.abortController.signal.aborted && i < pages.length - 1) {
        await sleep(DELAY_BETWEEN_MS);
      }
    }

    const wasCancelled = this.abortController.signal.aborted;
    this._isRunning = false;

    onProgress({
      total: pages.length,
      completed,
      failed,
      currentIndex: null,
      isRunning: false,
      isCancelled: wasCancelled,
      percentDone: 100,
    });

    onComplete({ completed, failed });
  }

  cancel(): void {
    this.abortController?.abort();
    this._isRunning = false;
  }
}

export const translationQueue = new TranslationQueueManager();
