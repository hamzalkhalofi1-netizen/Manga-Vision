/**
 * cvDebugStore.ts
 *
 * Module-level store that captures CV pipeline events from MangaPage
 * so they can be displayed on the in-app debug screen (Settings → Debug).
 *
 * Keeps the last MAX_ENTRIES events.  Listeners (React components) subscribe
 * to changes via subscribeCvDebug() and get notified synchronously.
 */

export type CvPipelineStatus = "pending" | "success" | "fallback_no_regions" | "fallback_null" | "fallback_error";

export interface CvDebugEntry {
  id: number;
  ts: number;
  status: CvPipelineStatus;
  cvPipelineUsed: boolean | "pending";
  fallbackRendererUsed: boolean;
  apiBase: string;
  inpaintedImageBytes: number;
  error: string | null;
  reason: string | null;
  refinedRegions: number | null;
  page: string;
}

const MAX_ENTRIES = 5;

let _seq = 0;
let _entries: CvDebugEntry[] = [];
const _listeners = new Set<(entries: CvDebugEntry[]) => void>();

export function recordCvDebug(entry: Omit<CvDebugEntry, "id" | "ts">): void {
  const full: CvDebugEntry = { id: ++_seq, ts: Date.now(), ...entry };
  _entries = [full, ..._entries].slice(0, MAX_ENTRIES);
  _listeners.forEach((fn) => fn(_entries));
}

export function getCvDebugEntries(): CvDebugEntry[] {
  return _entries;
}

export function clearCvDebugEntries(): void {
  _entries = [];
  _listeners.forEach((fn) => fn(_entries));
}

export function subscribeCvDebug(fn: (entries: CvDebugEntry[]) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
