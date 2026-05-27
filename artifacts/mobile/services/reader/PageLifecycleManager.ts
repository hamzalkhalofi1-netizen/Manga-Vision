/**
 * PageLifecycleManager — Page state machine for the reader.
 *
 * Mihon equivalent: The Page.State flow in Page.kt and ReaderPage.kt.
 * Each page transitions through: idle → queue → loading → ready | error
 *
 * State transitions:
 *   idle    → queue    (enqueued for prefetch)
 *   queue   → loading  (fetch started)
 *   loading → ready    (fetch succeeded + cached)
 *   loading → error    (fetch failed after all retries)
 *   error   → queue    (user retried)
 *   ready   → idle     (chapter recycled)
 *   any     → idle     (chapter/reader recycled)
 *
 * Observers can subscribe to state changes for a specific page or all pages.
 * This decouples the preloader from the UI layer.
 */

export type PageState = "idle" | "queue" | "loading" | "ready" | "error";

export interface PageStateEntry {
  index: number;
  state: PageState;
  error?: string;
  readyAt?: number;
}

type PageStateListener = (index: number, entry: PageStateEntry) => void;

export class PageLifecycleManager {
  private states: PageStateEntry[] = [];
  private listeners: PageStateListener[] = [];
  private currentPage = 0;

  // ── Setup ─────────────────────────────────────────────────────────────────

  setPageCount(count: number): void {
    this.states = Array.from({ length: count }, (_, i) => ({
      index: i,
      state: "idle",
    }));
    this.currentPage = 0;
  }

  setCurrentPage(index: number): void {
    this.currentPage = index;
  }

  reset(): void {
    this.states = [];
    this.listeners = [];
    this.currentPage = 0;
  }

  // ── State transitions ─────────────────────────────────────────────────────

  transitionTo(index: number, state: PageState, error?: string): void {
    if (index < 0 || index >= this.states.length) return;

    const entry = this.states[index];
    if (!this.isValidTransition(entry.state, state)) return;

    entry.state = state;
    entry.error = state === "error" ? error : undefined;
    entry.readyAt = state === "ready" ? Date.now() : entry.readyAt;

    this.listeners.forEach((l) => l(index, { ...entry }));
  }

  private isValidTransition(from: PageState, to: PageState): boolean {
    // idle can go anywhere (initial state or reset)
    if (from === "idle") return true;
    // queue → loading, queue → idle (dequeued)
    if (from === "queue") return to === "loading" || to === "idle";
    // loading → ready or error
    if (from === "loading") return to === "ready" || to === "error" || to === "queue";
    // error → queue (retry) or idle (recycle)
    if (from === "error") return to === "queue" || to === "idle";
    // ready → idle (recycle) only
    if (from === "ready") return to === "idle";
    return false;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getState(index: number): PageState {
    return this.states[index]?.state ?? "idle";
  }

  getEntry(index: number): PageStateEntry | null {
    return this.states[index] ? { ...this.states[index] } : null;
  }

  getAllStates(): PageStateEntry[] {
    return this.states.map((s) => ({ ...s }));
  }

  isReady(index: number): boolean {
    return this.getState(index) === "ready";
  }

  hasError(index: number): boolean {
    return this.getState(index) === "error";
  }

  getError(index: number): string | undefined {
    return this.states[index]?.error;
  }

  /**
   * Count pages in each state.
   */
  getStats(): Record<PageState, number> {
    const counts: Record<PageState, number> = {
      idle: 0,
      queue: 0,
      loading: 0,
      ready: 0,
      error: 0,
    };
    for (const entry of this.states) {
      counts[entry.state]++;
    }
    return counts;
  }

  /**
   * Indices of all pages currently in the given state.
   */
  getPagesInState(state: PageState): number[] {
    return this.states
      .filter((e) => e.state === state)
      .map((e) => e.index);
  }

  // ── Observers ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to all state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: PageStateListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Subscribe to state changes for a specific page only.
   */
  subscribeToPage(index: number, listener: (entry: PageStateEntry) => void): () => void {
    const wrapper: PageStateListener = (i, entry) => {
      if (i === index) listener(entry);
    };
    this.listeners.push(wrapper);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== wrapper);
    };
  }

  /**
   * Recycle all pages back to idle state (called on chapter change or reader exit).
   */
  recycleAll(): void {
    for (const entry of this.states) {
      entry.state = "idle";
      entry.error = undefined;
    }
    this.listeners.forEach((l) =>
      this.states.forEach((e) => l(e.index, { ...e }))
    );
  }
}
