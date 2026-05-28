/**
 * ReaderPreloader — Priority-based page preloader for the manga reader.
 *
 * Mihon equivalent: HttpPageLoader.kt — manages a priority queue of
 * pending page fetches, preloading ahead/behind the current page so
 * the reader always has images ready before the user scrolls to them.
 *
 * Architecture:
 *   - Priority levels: RETRY (3) > CURRENT (2) > AHEAD (1) > BEHIND (0)
 *   - Configurable preload window (default: 4 ahead, 2 behind)
 *   - Concurrent fetch slot limit to avoid overwhelming CDNs
 *   - Deduplicates pending requests — same page won't queue twice
 *   - On chapter change, clears all pending requests
 *   - Integrates with ReaderCache to skip already-cached pages
 *
 * Usage:
 *   const preloader = new ReaderPreloader({ ahead: 4, behind: 2, concurrency: 3 });
 *   preloader.onPageReady((index, uri) => { ... });
 *   preloader.setPages(pages, sourceId);
 *   preloader.onViewportChange(currentIndex);
 *   preloader.dispose();
 */

import { getBasicImageHeaders } from "../sourceImageHeaders";
import { ReaderCache } from "./ReaderCache";
import { PageState, PageLifecycleManager } from "./PageLifecycleManager";

export enum PreloadPriority {
  BEHIND = 0,
  AHEAD = 1,
  CURRENT = 2,
  RETRY = 3,
}

interface PendingPage {
  index: number;
  url: string;
  priority: PreloadPriority;
  attempt: number;
}

export interface PreloaderOptions {
  /** Number of pages to preload ahead of current (default: 4) */
  ahead?: number;
  /** Number of pages to preload behind current (default: 2) */
  behind?: number;
  /** Max concurrent fetch slots (default: 3) */
  concurrency?: number;
  /** Max retries per page (default: 2) */
  maxRetries?: number;
  /** Timeout per page fetch in ms (default: 20000) */
  timeoutMs?: number;
}

type PageReadyCallback = (index: number, cachedUri: string) => void;
type PageErrorCallback = (index: number, error: string) => void;

export class ReaderPreloader {
  private pages: string[] = [];
  private sourceId = "";
  private currentIndex = -1;

  private readonly ahead: number;
  private readonly behind: number;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  // Priority queue: sorted by priority descending
  private queue: PendingPage[] = [];
  private pending = new Set<number>(); // page indices currently fetching or queued
  private activeSlots = 0;
  private disposed = false;

  // Track AbortControllers for all active (in-flight) prefetch requests.
  // resetQueue() aborts these so chapter switches cancel ongoing fetches immediately.
  private activeControllers = new Set<AbortController>();

  private readonly lifecycle = new PageLifecycleManager();
  private readyCallbacks: PageReadyCallback[] = [];
  private errorCallbacks: PageErrorCallback[] = [];

  constructor(opts: PreloaderOptions = {}) {
    this.ahead = opts.ahead ?? 4;
    this.behind = opts.behind ?? 2;
    this.concurrency = opts.concurrency ?? 3;
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 20000;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Set the page list for the current chapter.
   * Resets all state and re-queues based on the current viewport.
   */
  setPages(pages: string[], sourceId: string): void {
    this.pages = pages;
    this.sourceId = sourceId;
    this.lifecycle.setPageCount(pages.length);
    this.resetQueue();
    if (this.currentIndex >= 0) {
      this.scheduleWindow(this.currentIndex);
    }
  }

  /**
   * Called when the visible page changes.
   * Adjusts the preload window and re-prioritises the queue.
   */
  onViewportChange(index: number): void {
    if (index === this.currentIndex) return;
    this.currentIndex = index;
    this.lifecycle.setCurrentPage(index);
    this.scheduleWindow(index);
  }

  /**
   * Force-retry a failed page with the highest priority.
   */
  retryPage(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    this.lifecycle.transitionTo(index, "queue");
    this.pending.delete(index);
    this.enqueue({ index, url: this.pages[index], priority: PreloadPriority.RETRY, attempt: 0 });
    this.drain();
  }

  /**
   * Get the current lifecycle state of a page.
   */
  getPageState(index: number): PageState {
    return this.lifecycle.getState(index);
  }

  /** Register a callback fired when a page becomes ready. */
  onPageReady(cb: PageReadyCallback): () => void {
    this.readyCallbacks.push(cb);
    return () => {
      this.readyCallbacks = this.readyCallbacks.filter((c) => c !== cb);
    };
  }

  /** Register a callback fired when a page permanently fails. */
  onPageError(cb: PageErrorCallback): () => void {
    this.errorCallbacks.push(cb);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter((c) => c !== cb);
    };
  }

  /** Dispose all resources. Call when leaving the reader. */
  dispose(): void {
    this.disposed = true;
    this.resetQueue();
    this.lifecycle.reset();
  }

  // ── Queue management ───────────────────────────────────────────────────────

  private scheduleWindow(center: number): void {
    if (this.pages.length === 0) return;

    // Enqueue current page first (highest priority)
    this.enqueueIfNeeded(center, PreloadPriority.CURRENT);

    // Ahead window
    for (let i = 1; i <= this.ahead; i++) {
      const idx = center + i;
      if (idx < this.pages.length) this.enqueueIfNeeded(idx, PreloadPriority.AHEAD);
    }

    // Behind window
    for (let i = 1; i <= this.behind; i++) {
      const idx = center - i;
      if (idx >= 0) this.enqueueIfNeeded(idx, PreloadPriority.BEHIND);
    }

    this.drain();
  }

  private enqueueIfNeeded(index: number, priority: PreloadPriority): void {
    const state = this.lifecycle.getState(index);
    // Skip if already ready or actively loading/queued
    if (state === "ready" || state === "loading") return;
    if (this.pending.has(index)) {
      // Upgrade priority if needed
      const existing = this.queue.find((p) => p.index === index);
      if (existing && existing.priority < priority) {
        existing.priority = priority;
        this.sortQueue();
      }
      return;
    }
    this.enqueue({ index, url: this.pages[index], priority, attempt: 0 });
  }

  private enqueue(page: PendingPage): void {
    this.pending.add(page.index);
    this.lifecycle.transitionTo(page.index, "queue");
    this.queue.push(page);
    this.sortQueue();
  }

  /** Sort queue: highest priority first; within same priority, lowest index first. */
  private sortQueue(): void {
    this.queue.sort((a, b) =>
      b.priority !== a.priority ? b.priority - a.priority : a.index - b.index,
    );
  }

  private resetQueue(): void {
    this.queue = [];
    this.pending.clear();
    this.activeSlots = 0;
    // Abort all in-flight prefetch requests so they don't ghost-complete
    // and call back into a now-stale chapter's lifecycle / callbacks.
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }

  private drain(): void {
    if (this.disposed) return;
    while (this.activeSlots < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.activeSlots++;
      this.fetchPage(next).finally(() => {
        this.activeSlots--;
        this.pending.delete(next.index);
        if (!this.disposed) this.drain();
      });
    }
  }

  // ── Page fetching ──────────────────────────────────────────────────────────

  private async fetchPage(page: PendingPage): Promise<void> {
    if (this.disposed) return;

    const { index, url } = page;

    // Cache hit — instant
    const cached = ReaderCache.get(url);
    if (cached) {
      this.lifecycle.transitionTo(index, "ready");
      this.readyCallbacks.forEach((cb) => cb(index, cached));
      return;
    }

    this.lifecycle.transitionTo(index, "loading");

    // Create a per-fetch AbortController so resetQueue() (chapter switch / dispose)
    // can cancel this specific in-flight request immediately.
    const controller = new AbortController();
    this.activeControllers.add(controller);

    try {
      // On React Native, expo-image handles caching internally.
      // We pre-warm it by issuing a prefetch request, which loads
      // the image into expo-image's disk + memory cache so it
      // renders instantly when the MangaPage component mounts.
      //
      // We also store the URL in ReaderCache as a lightweight
      // "this page is ready" marker so we don't re-prefetch.

      const headers = getBasicImageHeaders(this.sourceId);
      await this.prefetchImage(url, headers, controller.signal);

      // Guard: if aborted while awaiting, treat as cancelled (not ready, not error)
      if (controller.signal.aborted) return;

      // Mark as ready in both our lifecycle and the in-memory URL cache
      ReaderCache.set(url, url); // value = URI (passthrough; expo-image owns actual bytes)
      this.lifecycle.transitionTo(index, "ready");
      this.readyCallbacks.forEach((cb) => cb(index, url));
    } catch (err) {
      // Abort is intentional (chapter switch / dispose) — exit silently, no retry
      if (
        controller.signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);

      if (page.attempt < this.maxRetries) {
        // Re-enqueue with a short delay
        const retryPage: PendingPage = { ...page, attempt: page.attempt + 1, priority: PreloadPriority.RETRY };
        setTimeout(() => {
          if (!this.disposed) {
            this.pending.add(index);
            this.lifecycle.transitionTo(index, "queue");
            this.queue.unshift(retryPage);
            this.drain();
          }
        }, 1500 * (page.attempt + 1));
      } else {
        this.lifecycle.transitionTo(index, "error", msg);
        this.errorCallbacks.forEach((cb) => cb(index, msg));
      }
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  /**
   * Prefetch an image URL into expo-image's cache.
   * Falls back to a HEAD request on platforms where Image.prefetch isn't available.
   * The provided signal is checked before/after the prefetch and is forwarded to
   * the HEAD fallback so the network request is cancelled promptly on chapter switch.
   */
  private async prefetchImage(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;

    // Use expo-image's prefetch API
    try {
      const { Image } = await import("expo-image");
      if (typeof Image.prefetch === "function") {
        // expo-image prefetch has no cancellation API; we check signal before
        // and after so at least we don't fire callbacks on a dead chapter.
        await Image.prefetch(url, { headers });
        return;
      }
    } catch {}

    // Fallback: HEAD request to warm CDN + connection pool.
    // Combine external abort signal with our internal timeout signal.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    // Forward external abort to the timeout controller so either cancels the fetch
    signal.addEventListener("abort", () => timeoutController.abort(), { once: true });
    try {
      await fetch(url, { method: "HEAD", headers, signal: timeoutController.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
