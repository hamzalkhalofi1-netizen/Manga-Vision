/**
 * DownloadQueue — Priority queue for chapter downloads.
 *
 * Mihon equivalent: DownloadQueue.kt + Downloader.kt — manages a
 * queue of pending chapter downloads with concurrent page fetching,
 * per-chapter cancellation, retry on failure, and progress events.
 *
 * Architecture:
 *   - Each queued item = one chapter (metadata + page URLs)
 *   - Pages within a chapter are fetched concurrently (default: 3)
 *   - Overall chapter queue is FIFO (one chapter at a time by default)
 *   - Each chapter has an independent cancellation signal
 *   - Emits granular progress events for UI binding
 *
 * Usage:
 *   const queue = new DownloadQueue();
 *   queue.onProgress((event) => { ... });
 *   queue.onComplete((chapterId) => { ... });
 *   queue.enqueue({ chapterId, mangaId, pages, ... });
 *   queue.cancel(chapterId);
 *   queue.pauseAll();
 *   queue.resumeAll();
 */

import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export interface DownloadJob {
  chapterId: string;
  mangaId: string;
  chapterNum: string;
  mangaTitle: string;
  coverUrl: string;
  sourceId: string;
  pages: string[];
  /** Higher = sooner (default 0) */
  priority?: number;
}

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "done"
  | "error"
  | "cancelled";

export interface DownloadProgress {
  chapterId: string;
  status: DownloadStatus;
  pagesTotal: number;
  pagesDone: number;
  pagesFailed: number;
  bytesDownloaded: number;
  error?: string;
}

type ProgressListener = (progress: DownloadProgress) => void;
type CompleteListener = (chapterId: string) => void;
type ErrorListener = (chapterId: string, error: string) => void;

const PAGE_CONCURRENCY = 3;
const PAGE_MAX_RETRIES = 3;
const PAGE_TIMEOUT_MS = 30_000;

function chapterDir(sourceId: string, mangaId: string, chapterId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `${FileSystem.documentDirectory ?? ""}mv_downloads/${safe(sourceId)}/${safe(mangaId)}/${safe(chapterId)}/`;
}

async function downloadPage(
  url: string,
  destPath: string,
  attempt = 0,
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    // Check if already downloaded
    const info = await FileSystem.getInfoAsync(destPath);
    if (info.exists) {
      return (info as FileSystem.FileInfo & { size?: number }).size ?? 0;
    }
    const result = await FileSystem.downloadAsync(url, destPath);
    if (!result || (result.status && result.status >= 400)) {
      throw new Error(`HTTP ${result?.status ?? "unknown"}`);
    }
    const written = await FileSystem.getInfoAsync(destPath);
    return (written as FileSystem.FileInfo & { size?: number }).size ?? 0;
  } catch (err) {
    clearTimeout(timer);
    if (attempt < PAGE_MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return downloadPage(url, destPath, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class DownloadQueue {
  private readonly queue: DownloadJob[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly progress = new Map<string, DownloadProgress>();
  private isRunning = false;
  private isPaused = false;

  private progressListeners: ProgressListener[] = [];
  private completeListeners: CompleteListener[] = [];
  private errorListeners: ErrorListener[] = [];

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Add a chapter download to the queue. */
  enqueue(job: DownloadJob): void {
    if (Platform.OS === "web") return;
    // Deduplicate by chapterId
    if (this.queue.some((j) => j.chapterId === job.chapterId)) return;
    if (this.active.has(job.chapterId)) return;

    // Insert sorted by priority descending
    const insertIdx = this.queue.findIndex((j) => (j.priority ?? 0) < (job.priority ?? 0));
    if (insertIdx >= 0) {
      this.queue.splice(insertIdx, 0, job);
    } else {
      this.queue.push(job);
    }

    this.emitProgress({
      chapterId: job.chapterId,
      status: "queued",
      pagesTotal: job.pages.length,
      pagesDone: 0,
      pagesFailed: 0,
      bytesDownloaded: 0,
    });

    if (!this.isRunning && !this.isPaused) {
      this.processNext();
    }
  }

  /** Cancel a queued or active download. */
  cancel(chapterId: string): void {
    // Remove from queue
    const queueIdx = this.queue.findIndex((j) => j.chapterId === chapterId);
    if (queueIdx >= 0) this.queue.splice(queueIdx, 1);

    // Abort active download
    const ctrl = this.active.get(chapterId);
    if (ctrl) ctrl.abort();

    this.emitProgress({
      chapterId,
      status: "cancelled",
      pagesTotal: this.progress.get(chapterId)?.pagesTotal ?? 0,
      pagesDone: this.progress.get(chapterId)?.pagesDone ?? 0,
      pagesFailed: 0,
      bytesDownloaded: 0,
    });
    this.progress.delete(chapterId);
  }

  /** Pause all downloads (in-flight downloads finish their current page). */
  pauseAll(): void {
    this.isPaused = true;
    this.isRunning = false;
  }

  /** Resume downloading. */
  resumeAll(): void {
    this.isPaused = false;
    if (!this.isRunning) this.processNext();
  }

  /** True if a chapter is currently downloading or queued. */
  isPending(chapterId: string): boolean {
    return this.active.has(chapterId) || this.queue.some((j) => j.chapterId === chapterId);
  }

  /** Current progress snapshot for a chapter. */
  getProgress(chapterId: string): DownloadProgress | null {
    return this.progress.get(chapterId) ?? null;
  }

  /** All currently tracked progress entries. */
  getAllProgress(): DownloadProgress[] {
    return Array.from(this.progress.values());
  }

  /** Queue depth (chapters waiting). */
  get queueLength(): number {
    return this.queue.length;
  }

  // ── Event registration ─────────────────────────────────────────────────────

  onProgress(cb: ProgressListener): () => void {
    this.progressListeners.push(cb);
    return () => { this.progressListeners = this.progressListeners.filter((l) => l !== cb); };
  }

  onComplete(cb: CompleteListener): () => void {
    this.completeListeners.push(cb);
    return () => { this.completeListeners = this.completeListeners.filter((l) => l !== cb); };
  }

  onError(cb: ErrorListener): () => void {
    this.errorListeners.push(cb);
    return () => { this.errorListeners = this.errorListeners.filter((l) => l !== cb); };
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async processNext(): Promise<void> {
    if (this.isPaused || this.queue.length === 0) {
      this.isRunning = false;
      return;
    }

    const job = this.queue.shift()!;
    this.isRunning = true;
    const ctrl = new AbortController();
    this.active.set(job.chapterId, ctrl);

    try {
      await this.downloadChapter(job, ctrl.signal);
      this.completeListeners.forEach((l) => l(job.chapterId));
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        this.errorListeners.forEach((l) => l(job.chapterId, msg));
        this.emitProgress({
          ...(this.progress.get(job.chapterId) ?? {
            chapterId: job.chapterId,
            pagesTotal: job.pages.length,
            pagesDone: 0,
            pagesFailed: 0,
            bytesDownloaded: 0,
          }),
          status: "error",
          error: msg,
        });
      }
    } finally {
      this.active.delete(job.chapterId);
      if (!this.isPaused) this.processNext();
    }
  }

  private async downloadChapter(job: DownloadJob, signal: AbortSignal): Promise<void> {
    const dir = chapterDir(job.sourceId, job.mangaId, job.chapterId);
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    let pagesDone = 0;
    let pagesFailed = 0;
    let bytesDownloaded = 0;

    const emit = (status: DownloadStatus) => {
      this.emitProgress({
        chapterId: job.chapterId,
        status,
        pagesTotal: job.pages.length,
        pagesDone,
        pagesFailed,
        bytesDownloaded,
      });
    };

    emit("downloading");

    // Process pages in concurrent batches
    const total = job.pages.length;
    for (let batchStart = 0; batchStart < total; batchStart += PAGE_CONCURRENCY) {
      if (signal.aborted) throw new Error("Cancelled");

      const batchEnd = Math.min(batchStart + PAGE_CONCURRENCY, total);
      const batch = job.pages.slice(batchStart, batchEnd).map(async (url, i) => {
        if (signal.aborted) return;
        const destPath = `${dir}p${batchStart + i}.jpg`;
        try {
          const bytes = await downloadPage(url, destPath);
          pagesDone++;
          bytesDownloaded += bytes;
        } catch {
          pagesFailed++;
        }
        emit("downloading");
      });

      await Promise.all(batch);
    }

    emit("done");
  }

  private emitProgress(p: DownloadProgress): void {
    this.progress.set(p.chapterId, p);
    this.progressListeners.forEach((l) => l({ ...p }));
  }
}

/** Singleton download queue instance. */
export const downloadQueue = new DownloadQueue();
