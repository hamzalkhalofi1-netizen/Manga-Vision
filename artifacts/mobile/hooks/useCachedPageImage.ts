/**
 * useCachedPageImage — Cache-first image resolution for a single reader page.
 *
 * Drives the per-page loading/placeholder/retry UI required by the reader:
 *   1. Checks ImageDiskCache first — a valid hit resolves instantly (no
 *      network), which is what makes revisiting a chapter feel instant.
 *   2. On a miss, downloads the image (through ImageDiskCache's globally
 *      concurrency-limited queue, shared with ReaderPreloader) and persists
 *      it to disk automatically.
 *   3. Exposes `retry()` for a single page — invalidates any corrupted
 *      cache entry and re-downloads just that page, never the whole chapter.
 *
 * State machine: "checking" → "loading" → "ready" | "error"
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

export function useCachedPageImage(
  uri: string,
  headers: Record<string, string> | undefined
): UseCachedPageImageResult {
  const [status, setStatus] = useState<CachedImageStatus>(
    Platform.OS === "web" ? "ready" : "checking"
  );
  const [localUri, setLocalUri] = useState<string | null>(
    Platform.OS === "web" ? uri : null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guards against stale async results clobbering state after the uri
  // changes or the component recycles (FlatList reuses MangaPage instances).
  const runIdRef = useRef(0);
  const renderErrorHandledRef = useRef(false);

  const load = useCallback(
    (forceRedownload: boolean) => {
      if (Platform.OS === "web") {
        setStatus("ready");
        setLocalUri(uri);
        return;
      }

      const runId = ++runIdRef.current;
      renderErrorHandledRef.current = false;
      setErrorMessage(null);
      setStatus(forceRedownload ? "loading" : "checking");
      if (!forceRedownload) setLocalUri(null);

      (async () => {
        try {
          if (forceRedownload) {
            await ImageDiskCache.invalidate(uri);
          } else {
            const cached = await ImageDiskCache.getPath(uri);
            if (runIdRef.current !== runId) return;
            if (cached) {
              setLocalUri(cached);
              setStatus("ready");
              return;
            }
            setStatus("loading");
          }

          const downloaded = await ImageDiskCache.download(uri, headers);
          if (runIdRef.current !== runId) return;
          setLocalUri(downloaded);
          setStatus("ready");
        } catch (err) {
          if (runIdRef.current !== runId) return;
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
    load(true);
  }, [load]);

  const reportRenderError = useCallback(() => {
    if (renderErrorHandledRef.current) return;
    renderErrorHandledRef.current = true;
    load(true);
  }, [load]);

  return { status, localUri, errorMessage, retry, reportRenderError };
}
