/**
 * useReaderPreloader — React hook wrapping ReaderPreloader.
 *
 * Mounts a preloader for the current chapter, feeding it page URLs and
 * viewport position. Disposes cleanly on chapter change or unmount.
 *
 * The preloader warms expo-image's cache for pages ahead/behind the
 * current viewport so images are ready before the user scrolls to them
 * (equivalent to Mihon's HttpPageLoader preload window).
 */

import { useEffect, useRef, useCallback } from "react";
import { ReaderPreloader } from "@/services/reader/ReaderPreloader";
import { ReaderCache } from "@/services/reader/ReaderCache";

interface UseReaderPreloaderOptions {
  pages: string[];
  sourceId: string;
  currentPage: number;
  enabled?: boolean;
}

export function useReaderPreloader({
  pages,
  sourceId,
  currentPage,
  enabled = true,
}: UseReaderPreloaderOptions) {
  const preloaderRef = useRef<ReaderPreloader | null>(null);

  // Initialize or reinitialize preloader when chapter changes (new pages set)
  useEffect(() => {
    if (!enabled || pages.length === 0) return;

    // Create fresh preloader for each chapter
    const preloader = new ReaderPreloader({ ahead: 4, behind: 2, concurrency: 3 });
    preloaderRef.current = preloader;

    preloader.setPages(pages, sourceId);
    preloader.onViewportChange(0);

    return () => {
      preloader.dispose();
      ReaderCache.clear();
      preloaderRef.current = null;
    };
  }, [pages, sourceId, enabled]);

  // Notify preloader when viewport changes
  useEffect(() => {
    if (!enabled) return;
    preloaderRef.current?.onViewportChange(currentPage);
  }, [currentPage, enabled]);

  const retryPage = useCallback((index: number) => {
    preloaderRef.current?.retryPage(index);
  }, []);

  const getPageState = useCallback((index: number) => {
    return preloaderRef.current?.getPageState(index) ?? "idle";
  }, []);

  return { retryPage, getPageState };
}
