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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { ImageDiskCache } from "@/services/cache/ImageDiskCache";

export type CachedImageStatus = "checking" | "loading" | "ready" | "error";

interface UseCachedPageImageResult {
  status: CachedImageStatus;
  localUri: string | null;
  errorMessage: string | null;
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

  const runIdRef = useRef(0);
  // FIX for BUG 1: this ref must NOT be reset inside load(true) — only on a
  // fresh URI load — so the "one auto-retry" guarantee actually holds.
  const renderErrorHandledRef = useRef(false);

  const load = useCallback(
    (forceRedownload: boolean) => {
      if (Platform.OS === "web") {
        setStatus("ready");
        setLocalUri(uri);
        return;
      }

      const runId = ++runIdRef.current;
      // BUG 1 FIX: only reset the render-error guard on a fresh load, not on
      // a force-redownload (which is itself triggered by reportRenderError).
      if (!forceRedownload) {
        renderErrorHandledRef.current = false;
      }
      setErrorMessage(null);

      if (!forceRedownload) {
        // BUG 2 FIX fast path: if the URI is already in the resolved-path map,
        // apply it immediately (synchronous, no I/O) and verify in the
        // background. This prevents any spinner flash on FlatList remount.
        const memPath = _resolvedPaths.get(uri);
        if (memPath) {
          setLocalUri(memPath);
          setStatus("ready");
          // Background verify — won't flash the UI (we already showed the image).
          (async () => {
            const verified = await ImageDiskCache.getPath(uri);
            if (runIdRef.current !== runId) return;
            if (!verified) {
              // File was evicted from disk — re-download silently.
              _resolvedPaths.delete(uri);
              setStatus("loading");
              try {
                const downloaded = await ImageDiskCache.download(uri, headers);
                if (runIdRef.current !== runId) return;
                _resolvedPaths.set(uri, downloaded);
                setLocalUri(downloaded);
                setStatus("ready");
              } catch (err) {
                if (runIdRef.current !== runId) return;
                _resolvedPaths.delete(uri);
                setErrorMessage(err instanceof Error ? err.message : String(err));
                setStatus("error");
              }
            } else if (verified !== memPath) {
              // Path changed (shouldn't happen normally, but stay correct).
              _resolvedPaths.set(uri, verified);
              setLocalUri(verified);
            }
          })();
          return;
        }
      }

      // Slow path — no memory cache hit (first visit, or forced redownload).
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
              _resolvedPaths.set(uri, cached);
              setLocalUri(cached);
              setStatus("ready");
              return;
            }
            setStatus("loading");
          }

          const downloaded = await ImageDiskCache.download(uri, headers);
          if (runIdRef.current !== runId) return;
          _resolvedPaths.set(uri, downloaded);
          setLocalUri(downloaded);
          setStatus("ready");
        } catch (err) {
          if (runIdRef.current !== runId) return;
          _resolvedPaths.delete(uri);
          const msg = err instanceof Error ? err.message : String(err);
          setErrorMessage(msg);
          setStatus("error");
        }
      })();
    },
    [uri, headers]
  );

  useEffect(() => {
    load(false);
    return () => {
      runIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const retry = useCallback(() => {
    // User-initiated retry: reset the render-error guard so reportRenderError
    // can fire once more if the newly downloaded file also fails to decode.
    renderErrorHandledRef.current = false;
    load(true);
  }, [load]);

  const reportRenderError = useCallback(() => {
    if (renderErrorHandledRef.current) return; // BUG 1 FIX: guard now holds
    renderErrorHandledRef.current = true;
    load(true);
  }, [load]);

  return { status, localUri, errorMessage, retry, reportRenderError };
}
