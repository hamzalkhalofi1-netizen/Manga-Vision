/**
 * useCachedPageImage — Cache-first image resolution for a single reader page.
 *
 * State machine: "checking" → "loading" → "ready" | "error"
 *
 * Two bugs fixed here (root causes of reader flickering):
 *
 * BUG 1 — reportRenderError infinite loop:
 *   renderErrorHandledRef.current was reset to false inside every load() call,
 *   including the load(true) call triggered by reportRenderError itself. So the
 *   "allow one automatic retry" guard was wiped on that very retry, causing an
 *   infinite cycle: onError → load(true) → reset guard → onError → ...
 *   Fix: only reset the guard on a fresh URI load (load(false)), never on a
 *   force-redownload triggered by reportRenderError.
 *
 * BUG 2 — FlatList remount causes spinner flash on cached pages:
 *   FlatList (windowSize=5) unmounts MangaPage instances that scroll outside
 *   the render window. On remount, React resets all state to the initial value
 *   (status="checking", localUri=null), so the Image is hidden and a spinner
 *   appears even though the file is already in the disk cache. getPath() is
 *   async (filesystem stat), so there is always a visible blank → spinner →
 *   image cycle even for pages the user has already seen.
 *   Fix: maintain a module-level resolved-path map. Initialise the hook state
 *   synchronously from this map so remounted pages start at status="ready"
 *   with the correct localUri — no spinner, no flash. The async disk verify
 *   still runs in the background; if the file was evicted it re-downloads
 *   without touching the visible UI until the new path is confirmed.
 *
 * BUG 3 — _inFlight AbortError propagation from ReaderPreloader:
 *   ImageDiskCache._inFlight de-duplicates concurrent downloads of the same URL.
 *   ReaderPreloader creates downloads WITH an AbortSignal; useCachedPageImage
 *   joins those same _inFlight promises WITHOUT a signal. When the preloader
 *   aborts (e.g. on chapter change / pages reference change), the AbortError
 *   propagates to useCachedPageImage which has no AbortError guard — it was
 *   setting status="error" even though the component never requested an abort.
 *   Fix: detect AbortError in the catch block and retry with a fresh independent
 *   download (no signal) instead of transitioning to "error" state.
 *
 * BUG 4 — background verify calls setStatus("loading"), hiding visible image:
 *   When the disk verify finds a file has been evicted, the code called
 *   setStatus("loading") before starting the re-download. imageNotReady is
 *   true whenever pageStatus !== "ready", so this UNMOUNTS the Image component
 *   causing a visible flash — contrary to the comment that said "won't flash".
 *   Fix: keep showing the current (stale) localUri while re-downloading silently;
 *   only swap to the new localUri once the fresh download completes. The status
 *   stays "ready" throughout, so the Image component remains mounted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { ImageDiskCache } from "@/services/cache/ImageDiskCache";

export type CachedImageStatus =
  | "checking"
  | "loading"
  | "retrying"
  | "ready"
  | "error";

const MAX_AUTO_RETRIES = 5;
// Exponential backoff: 1s, 2s, 4s, 8s, 16s between attempts.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

interface UseCachedPageImageResult {
  status: CachedImageStatus;
  localUri: string | null;
  errorMessage: string | null;
  /** Download progress 0-1 for the in-progress attempt, or null when unknown
   *  (e.g. server didn't report Content-Length) — render an indeterminate
   *  spinner in that case instead of a stalled progress ring. */
  progress: number | null;
  /** 1-based attempt number while status === "retrying" (2..MAX_AUTO_RETRIES+1). */
  retryAttempt: number;
  retryMax: number;
  retry: () => void;
  /** Call when the resolved local file fails to actually render (corruption
   *  that slipped past the size check) — invalidates + re-downloads once. */
  reportRenderError: () => void;
}

// ── Module-level resolved-path cache (FIX for BUG 2) ─────────────────────────
// Maps remote URI → confirmed local file path. Populated whenever a path is
// successfully resolved (cache hit or fresh download). Lets the hook initialise
// synchronously to "ready" on FlatList remounts so no spinner is ever shown for
// pages the user has already scrolled past.
// This is intentionally NOT persisted across app launches (that is the job of
// ImageDiskCache); it is just a React-render-cycle shortcut.
const _resolvedPaths = new Map<string, string>();

/** Return the exact local file currently resolved for a reader page. */
export function getResolvedPageImageUri(uri: string): string | null {
  return Platform.OS !== "web" ? (_resolvedPaths.get(uri) ?? null) : null;
}

// ── Diagnostic logging ────────────────────────────────────────────────────────
// Logs status transitions and the reason, keyed by the last 50 chars of URI.
// Search for "[useCachedPageImage]" in the Metro/device logs to trace flicker.
const LOG_ENABLED = __DEV__;

function logTransition(uri: string, event: string, detail?: string): void {
  if (!LOG_ENABLED) return;
  const key = uri.slice(-50);
  const msg = detail ? `${event} | ${detail}` : event;
  console.log(`[useCachedPageImage] ${key} → ${msg}`);
}

export function useCachedPageImage(
  uri: string,
  headers: Record<string, string> | undefined
): UseCachedPageImageResult {
  // Synchronous init from the resolved-path map (FIX for BUG 2).
  // If we have already resolved this URI in this app session, start at "ready"
  // with the known local path — no async I/O, no spinner flash on remount.
  const knownPath = Platform.OS !== "web" ? (_resolvedPaths.get(uri) ?? null) : null;

  const [status, setStatus] = useState<CachedImageStatus>(() => {
    if (Platform.OS === "web") return "ready";
    return knownPath ? "ready" : "checking";
  });
  const [localUri, setLocalUri] = useState<string | null>(() => {
    if (Platform.OS === "web") return uri;
    return knownPath;
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const runIdRef = useRef(0);
  // FIX for BUG 1: this ref must NOT be reset inside load(true) — only on a
  // fresh URI load — so the "one auto-retry" guarantee actually holds.
  const renderErrorHandledRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-retry with exponential backoff (1s/2s/4s/8s/16s), up to
  // MAX_AUTO_RETRIES attempts, before finally surfacing "error" with a
  // manual retry button. Only this single page is affected — never blocks
  // or re-triggers neighbouring pages.
  const downloadWithAutoRetry = useCallback(
    async (
      runId: number,
      forceIndependent: boolean
    ): Promise<string> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
        if (runIdRef.current !== runId) throw new Error("stale run");
        if (attempt > 0) {
          setStatus("retrying");
          setRetryAttempt(attempt + 1);
          logTransition(uri, `auto-retry wait`, `attempt=${attempt + 1}/${MAX_AUTO_RETRIES + 1}`);
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1] ?? 16000)
          );
          if (runIdRef.current !== runId) throw new Error("stale run");
        }
        setProgress(null);
        try {
          return await ImageDiskCache.download(
            uri,
            headers,
            undefined,
            forceIndependent || attempt > 0,
            (fraction) => {
              if (runIdRef.current === runId) setProgress(fraction);
            }
          );
        } catch (err) {
          lastErr = err;
          if (err instanceof Error && err.name === "AbortError" && attempt === 0) {
            // Let the caller's existing AbortError handling (retry via
            // forceIndependent) take over on the very first attempt only.
            throw err;
          }
          logTransition(uri, `attempt ${attempt + 1} failed`, err instanceof Error ? err.message : String(err));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("Download failed after retries");
    },
    [uri, headers]
  );

  const load = useCallback(
    (forceRedownload: boolean) => {
      if (Platform.OS === "web") {
        setStatus("ready");
        setLocalUri(uri);
        return;
      }

      const runId = ++runIdRef.current;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      // BUG 1 FIX: only reset the render-error guard on a fresh load, not on
      // a force-redownload (which is itself triggered by reportRenderError).
      if (!forceRedownload) {
        renderErrorHandledRef.current = false;
      }
      setErrorMessage(null);
      setProgress(null);
      setRetryAttempt(0);

      if (!forceRedownload) {
        // BUG 2 FIX fast path: if the URI is already in the resolved-path map,
        // apply it immediately (synchronous, no I/O) and verify in the
        // background. This prevents any spinner flash on FlatList remount.
        const memPath = _resolvedPaths.get(uri);
        if (memPath) {
          setLocalUri(memPath);
          setStatus("ready");
          logTransition(uri, "fast-path ready", `memPath=${memPath.slice(-30)}`);
          // BUG 4 FIX: Background verify — keep image VISIBLE throughout.
          // If the file was evicted, re-download silently and swap the URI
          // only after the new file is confirmed. Status stays "ready" so
          // the Image component is never unmounted during the re-download.
          (async () => {
            const verified = await ImageDiskCache.getPath(uri);
            if (runIdRef.current !== runId) return;
            if (!verified) {
              logTransition(uri, "bg-verify MISS — silent redownload (image stays visible)");
              // File evicted — delete stale mem entry and re-download.
              // DO NOT call setStatus("loading") here — that would unmount
              // the Image component (imageNotReady becomes true). Instead,
              // keep showing the old localUri while the new file is fetched,
              // and silently swap the URI only when the new file is confirmed.
              _resolvedPaths.delete(uri);
              try {
                // BUG 3 FIX: use forceIndependent=true so this download is NOT
                // registered in _inFlight and cannot be aborted by a preloader
                // signal. We guarantee our own non-abortable download.
                const downloaded = await ImageDiskCache.download(uri, headers, undefined, true);
                if (runIdRef.current !== runId) return;
                _resolvedPaths.set(uri, downloaded);
                setLocalUri(downloaded);
                // status stays "ready" — Image component never unmounted
                logTransition(uri, "bg-redownload done", `path=${downloaded.slice(-30)}`);
              } catch (err) {
                if (runIdRef.current !== runId) return;
                const msg = err instanceof Error ? err.message : String(err);
                logTransition(uri, "bg-redownload FAILED (non-fatal — keeping image visible)", msg);
                // Background verify failure is NON-FATAL: we already have a rendered
                // image (old localUri). DO NOT set status="error" — the user would
                // see the image disappear for a network/CDN failure they didn't cause.
                // Leave status="ready" and the old localUri in place. The next mount
                // cycle will retry the full load from scratch.
              }
            } else if (verified !== memPath) {
              // Path changed (shouldn't happen normally, but stay correct).
              logTransition(uri, "bg-verify path changed", `${memPath.slice(-20)} → ${verified.slice(-20)}`);
              _resolvedPaths.set(uri, verified);
              setLocalUri(verified);
            } else {
              logTransition(uri, "bg-verify OK");
            }
          })();
          return;
        }
      }

      // Slow path — no memory cache hit (first visit, or forced redownload).
      logTransition(uri, forceRedownload ? "force-redownload" : "slow-path (disk check)");
      setStatus(forceRedownload ? "loading" : "checking");
      if (!forceRedownload) setLocalUri(null);

      (async () => {
        try {
          if (forceRedownload) {
            _resolvedPaths.delete(uri);
            await ImageDiskCache.invalidate(uri);
          } else {
            const cached = await ImageDiskCache.getPath(uri);
            if (runIdRef.current !== runId) return;
            if (cached) {
              logTransition(uri, "disk-hit", `path=${cached.slice(-30)}`);
              _resolvedPaths.set(uri, cached);
              setLocalUri(cached);
              setStatus("ready");
              return;
            }
            logTransition(uri, "disk-miss — downloading");
            setStatus("loading");
          }

          // BUG 3 FIX: If download throws AbortError (from a shared _inFlight
          // promise owned by the ReaderPreloader's AbortController), we must
          // NOT propagate it to "error" state — this component never requested
          // an abort. Retry with forceIndependent=true so the retry:
          //   (a) is not registered in _inFlight and cannot be aborted by
          //       any preloader abort signal, and
          //   (b) does not overwrite an active preloader _inFlight entry.
          // Beyond that first AbortError hop, downloadWithAutoRetry owns up to
          // MAX_AUTO_RETRIES further attempts with exponential backoff before
          // this page (and only this page) is marked "error".
          let downloaded: string;
          try {
            downloaded = await downloadWithAutoRetry(runId, false);
          } catch (dlErr) {
            if (runIdRef.current !== runId) return;
            if (dlErr instanceof Error && dlErr.name === "AbortError") {
              logTransition(uri, "download got AbortError (from preloader) — retrying independently");
              // forceIndependent=true: own download, not shareable, not abortable.
              downloaded = await downloadWithAutoRetry(runId, true);
            } else {
              throw dlErr;
            }
          }

          if (runIdRef.current !== runId) return;
          logTransition(uri, "download done", `path=${downloaded.slice(-30)}`);
          _resolvedPaths.set(uri, downloaded);
          setLocalUri(downloaded);
          setProgress(null);
          setRetryAttempt(0);
          setStatus("ready");
        } catch (err) {
          if (runIdRef.current !== runId) return;
          _resolvedPaths.delete(uri);
          const msg = err instanceof Error ? err.message : String(err);
          logTransition(uri, "FAILED (after auto-retries)", msg);
          setErrorMessage(msg);
          setProgress(null);
          setStatus("error");
        }
      })();
    },
    [uri, headers, downloadWithAutoRetry]
  );

  useEffect(() => {
    logTransition(uri, `effect mount — knownPath=${_resolvedPaths.has(uri)}`);
    load(false);
    return () => {
      logTransition(uri, "effect cleanup (unmount or uri change)");
      runIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const retry = useCallback(() => {
    // User-initiated retry: reset the render-error guard so reportRenderError
    // can fire once more if the newly downloaded file also fails to decode.
    renderErrorHandledRef.current = false;
    setRetryAttempt(0);
    load(true);
  }, [load]);

  const reportRenderError = useCallback(() => {
    if (renderErrorHandledRef.current) {
      logTransition(uri, "reportRenderError BLOCKED by guard (already handled)");
      return; // BUG 1 FIX: guard now holds
    }
    logTransition(uri, "reportRenderError — force redownload");
    renderErrorHandledRef.current = true;
    load(true);
  }, [load, uri]);

  return {
    status,
    localUri,
    errorMessage,
    progress,
    retryAttempt,
    retryMax: MAX_AUTO_RETRIES,
    retry,
    reportRenderError,
  };
}
