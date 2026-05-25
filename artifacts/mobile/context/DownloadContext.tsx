import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import * as DM from "@/services/downloadManager";

export type DownloadState = "idle" | "downloading" | "done" | "error";

export interface DownloadProgress {
  done: number;
  total: number;
}

interface DownloadContextValue {
  downloads: DM.DownloadRecord[];
  dlState: Record<string, DownloadState>;
  dlProgress: Record<string, DownloadProgress>;
  downloadChapter: (
    mangaId: string,
    chapterId: string,
    chapterNum: string,
    mangaTitle: string,
    coverUrl: string,
    sourceId: string,
    pages: string[]
  ) => Promise<void>;
  deleteChapter: (sourceId: string, mangaId: string, chapterId: string) => Promise<void>;
  isDownloaded: (chapterId: string) => boolean;
  refreshDownloads: () => Promise<void>;
}

const DownloadContext = createContext<DownloadContextValue>({
  downloads: [],
  dlState: {},
  dlProgress: {},
  downloadChapter: async () => {},
  deleteChapter: async () => {},
  isDownloaded: () => false,
  refreshDownloads: async () => {},
});

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [downloads, setDownloads] = useState<DM.DownloadRecord[]>([]);
  const [dlState, setDlState] = useState<Record<string, DownloadState>>({});
  const [dlProgress, setDlProgress] = useState<Record<string, DownloadProgress>>({});
  const cancelSignals = useRef<Record<string, { cancelled: boolean }>>({});

  const refreshDownloads = useCallback(async () => {
    if (Platform.OS === "web") return;
    const list = await DM.listDownloads();
    setDownloads(list);
    setDlState((prev) => {
      const next = { ...prev };
      for (const r of list) {
        if (next[r.chapterId] !== "downloading") {
          next[r.chapterId] = "done";
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    refreshDownloads();
  }, [refreshDownloads]);

  const downloadChapter = useCallback(
    async (
      mangaId: string,
      chapterId: string,
      chapterNum: string,
      mangaTitle: string,
      coverUrl: string,
      sourceId: string,
      pages: string[]
    ) => {
      if (Platform.OS === "web") return;

      const signal = { cancelled: false };
      cancelSignals.current[chapterId] = signal;

      setDlState((prev) => ({ ...prev, [chapterId]: "downloading" }));
      setDlProgress((prev) => ({ ...prev, [chapterId]: { done: 0, total: pages.length } }));

      try {
        await DM.downloadChapter(
          mangaId,
          chapterId,
          chapterNum,
          mangaTitle,
          coverUrl,
          sourceId,
          pages,
          (done, total) => {
            setDlProgress((prev) => ({ ...prev, [chapterId]: { done, total } }));
          },
          signal
        );
        setDlState((prev) => ({ ...prev, [chapterId]: "done" }));
        await refreshDownloads();
      } catch (err) {
        const cancelled = signal.cancelled;
        setDlState((prev) => ({ ...prev, [chapterId]: cancelled ? "idle" : "error" }));
      } finally {
        delete cancelSignals.current[chapterId];
      }
    },
    [refreshDownloads]
  );

  const deleteChapter = useCallback(
    async (sourceId: string, mangaId: string, chapterId: string) => {
      const sig = cancelSignals.current[chapterId];
      if (sig) sig.cancelled = true;
      await DM.deleteDownload(sourceId, mangaId, chapterId);
      setDlState((prev) => {
        const next = { ...prev };
        delete next[chapterId];
        return next;
      });
      setDlProgress((prev) => {
        const next = { ...prev };
        delete next[chapterId];
        return next;
      });
      await refreshDownloads();
    },
    [refreshDownloads]
  );

  const isDownloaded = useCallback(
    (chapterId: string) => dlState[chapterId] === "done",
    [dlState]
  );

  return (
    <DownloadContext.Provider
      value={{
        downloads,
        dlState,
        dlProgress,
        downloadChapter,
        deleteChapter,
        isDownloaded,
        refreshDownloads,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}

export const useDownloads = () => useContext(DownloadContext);
