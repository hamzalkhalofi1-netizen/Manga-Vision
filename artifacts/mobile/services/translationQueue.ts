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
  onPageTranslated: OnPageTranslated;
  onProgress: OnProgressUpdate;
  onComplete: (stats: { completed: number; failed: number }) => void;
}

const DELAY_BETWEEN_MS = 700;
const MAX_RETRIES = 2;
const PAGE_TIMEOUT_MS = 35_000;

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

    const { pages, targetLanguage, apiBase, onPageTranslated, onProgress, onComplete } = params;

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

    for (let i = 0; i < pages.length; i++) {
      if (this.abortController.signal.aborted) break;

      emit(i);

      let success = false;

      for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
        if (this.abortController.signal.aborted) break;

        try {
          const res = await fetchWithTimeout(
            `${apiBase}/api/translate-image`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageUrl: pages[i],
                targetLanguage,
              }),
            },
            PAGE_TIMEOUT_MS
          );

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json();

          if (data.regions?.length > 0) {
            onPageTranslated(i, data.regions, data.summary ?? "");
          } else {
            onPageTranslated(i, [], data.summary ?? "");
          }

          success = true;
          completed++;
        } catch (err) {
          if (attempt < MAX_RETRIES - 1) {
            await sleep(1200);
          } else {
            failed++;
            console.warn(`[TranslationQueue] Page ${i} failed after ${MAX_RETRIES} attempts`, err);
          }
        }
      }

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
