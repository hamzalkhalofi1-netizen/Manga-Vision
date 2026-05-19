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
  onPageTranslated: OnPageTranslated;
  onProgress: OnProgressUpdate;
  onComplete: (stats: { completed: number; failed: number }) => void;
  onRateLimited?: () => void;
}

const DELAY_BETWEEN_MS = 800;
const MAX_RETRIES = 2;
const PAGE_TIMEOUT_MS = 60_000;

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
      onPageTranslated,
      onProgress,
      onComplete,
      onRateLimited,
    } = params;

    let completed = 0;
    let failed = 0;

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

      for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
        if (this.abortController.signal.aborted) break;

        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (userApiKey) headers["X-Gemini-Key"] = userApiKey;

          // Send the CDN URL directly — the server fetches and encodes it.
          // This avoids client-side CORS/fetch issues with the manga CDN.
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

          if (res.status === 429) {
            onRateLimited?.();
            // Stop the whole queue — key is exhausted
            this.abortController?.abort();
            break;
          }

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();

          onPageTranslated(
            i,
            data.regions?.length > 0 ? data.regions : [],
            data.summary ?? ""
          );

          success = true;
          completed++;
        } catch (err) {
          console.warn(`[TranslationQueue] Page ${i} attempt ${attempt + 1} failed:`, err);
          if (attempt < MAX_RETRIES - 1) {
            await sleep(1500 * (attempt + 1));
          } else {
            failed++;
          }
        }
      }

      // Wait between pages to avoid RESOURCE_EXHAUSTED from Gemini
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
