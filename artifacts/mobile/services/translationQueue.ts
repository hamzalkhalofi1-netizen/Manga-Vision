import AsyncStorage from "@react-native-async-storage/async-storage";
import { callInpaintServer } from "./inpaintClient";
import { translateImage, TranslatedRegion } from "./geminiTranslate";

export type TextRegion = TranslatedRegion;

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
  sourceId: string;
  userApiKey?: string | null;
  inpaintServerUrl?: string | null;
  onPageTranslated: OnPageTranslated;
  onProgress: OnProgressUpdate;
  onComplete: (stats: { completed: number; failed: number }) => void;
  onRateLimited?: () => void;
  onPageError?: (pageIndex: number, errorMessage: string) => void;
}

/**
 * How many pages to translate simultaneously.
 * Gemini 2.5 Flash has generous rate limits; 4 parallel requests is safe
 * while providing ~4× speed improvement over sequential processing.
 */
const PARALLEL_BATCH_SIZE = 4;

/**
 * Delay between batches (ms). Prevents bursting too many requests at once
 * and gives the API breathing room between batches.
 */
const BATCH_DELAY_MS = 500;

const MAX_RETRIES = 2;
const PAGE_TIMEOUT_MS = 60_000;

// ── Persistent page translation cache ─────────────────────────────────────────

interface CachedPage {
  regions: TextRegion[];
  summary: string;
}

const CACHE_STORAGE_KEY = "@mangaverse_tc_v2";
const CACHE_MAX_STORED = 60;

const pageCache = new Map<string, CachedPage>();

let _cacheHydrated = false;
let _hydratePromise: Promise<void> | null = null;

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

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const entries = Array.from(pageCache.entries()).slice(-CACHE_MAX_STORED);
      await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries));
    } catch {}
  }, 2000);
}

function cacheKey(url: string, lang: string): string {
  return `${url}|${lang}`;
}

export async function clearTranslationCache(): Promise<void> {
  pageCache.clear();
  _cacheHydrated = false;
  _hydratePromise = null;
  try {
    await AsyncStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {}
}

export function getTranslationCacheSize(): number {
  return pageCache.size;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ── Queue ──────────────────────────────────────────────────────────────────────

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
      sourceId,
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

    // ── Phase 1: Instant cache hits ─────────────────────────────────────────
    // Resolve all cached pages immediately before starting any network work.
    // This makes revisited chapters / pages appear instantly.

    const pendingIndices: number[] = [];

    for (let i = 0; i < pages.length; i++) {
      if (this.abortController.signal.aborted) break;

      const key    = cacheKey(pages[i], targetLanguage);
      const cached = pageCache.get(key);

      if (cached) {
        console.log(`[TranslationQueue] Page ${i} — cache hit`);
        onPageTranslated(i, cached.regions, cached.summary);
        completed++;
      } else {
        pendingIndices.push(i);
      }
    }

    emit(null);

    // ── Phase 2: Parallel batch processing ─────────────────────────────────
    // Process uncached pages PARALLEL_BATCH_SIZE at a time.
    // Each page retries independently; rate-limit on any page aborts all.

    for (
      let batchStart = 0;
      batchStart < pendingIndices.length;
      batchStart += PARALLEL_BATCH_SIZE
    ) {
      if (this.abortController.signal.aborted) break;

      const batch = pendingIndices.slice(batchStart, batchStart + PARALLEL_BATCH_SIZE);

      console.log(
        `[TranslationQueue] Batch ${Math.floor(batchStart / PARALLEL_BATCH_SIZE) + 1}` +
        ` — pages [${batch.join(", ")}]`
      );

      await Promise.allSettled(
        batch.map(async (pageIdx) => {
          if (this.abortController!.signal.aborted) return;

          emit(pageIdx);

          const pageUrl = pages[pageIdx];
          const key     = cacheKey(pageUrl, targetLanguage);

          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            if (this.abortController!.signal.aborted) return;

            try {
              // ── Inpaint server path ─────────────────────────────────────
              if (inpaintServerUrl) {
                const result = await callInpaintServer(
                  inpaintServerUrl, pageUrl, [], PAGE_TIMEOUT_MS
                );
                pageCache.set(key, { regions: result.regions, summary: result.summary });
                scheduleSave();
                onPageTranslated(pageIdx, result.regions, result.summary);
                completed++;
                console.log(`[TranslationQueue] Page ${pageIdx} — inpaint success`);
                return;
              }

              // ── Direct Gemini path ──────────────────────────────────────
              if (!userApiKey) {
                const msg =
                  "No Gemini API key. Open Settings → Gemini API Keys and add your key.";
                console.error(`[TranslationQueue] Page ${pageIdx} — ${msg}`);
                this.abortController?.abort();
                onPageError?.(pageIdx, msg);
                return;
              }

              console.log(
                `[TranslationQueue] Page ${pageIdx} — Gemini direct (attempt ${attempt + 1})`
              );

              const result = await withTimeout(
                translateImage(pageUrl, targetLanguage, userApiKey, sourceId),
                PAGE_TIMEOUT_MS
              );

              pageCache.set(key, { regions: result.regions, summary: result.summary });
              scheduleSave();
              onPageTranslated(pageIdx, result.regions, result.summary);
              completed++;

              console.log(
                `[TranslationQueue] Page ${pageIdx} — success regions=${result.regions.length}`
              );
              return;
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[TranslationQueue] Page ${pageIdx} attempt ${attempt + 1} failed: ${errMsg}`
              );

              if (errMsg === "RATE_LIMITED") {
                onRateLimited?.();
                this.abortController?.abort();
                return;
              }

              if (errMsg.includes("API_KEY_INVALID")) {
                this.abortController?.abort();
                onPageError?.(
                  pageIdx,
                  "Your Gemini API key is not valid. Open Settings → Gemini API Keys and add a working key."
                );
                return;
              }

              if (attempt < MAX_RETRIES - 1) {
                await sleep(1500 * (attempt + 1));
              } else {
                failed++;
                onPageError?.(pageIdx, errMsg);
              }
            }
          }
        })
      );

      // Small delay between batches — courteous to API rate limits
      if (
        batchStart + PARALLEL_BATCH_SIZE < pendingIndices.length &&
        !this.abortController.signal.aborted
      ) {
        await sleep(BATCH_DELAY_MS);
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
