import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { LibraryEntry, LibraryStatus, Manga, ReadingProgress } from "@/services/sources/types";

const LIBRARY_KEY = "mangaverse_library";
const PROGRESS_KEY = "mangaverse_progress";

interface LibraryContextType {
  entries: LibraryEntry[];
  progress: Record<string, ReadingProgress>;
  addToLibrary: (manga: Manga, status: LibraryStatus) => void;
  removeFromLibrary: (mangaId: string) => void;
  updateStatus: (mangaId: string, status: LibraryStatus) => void;
  saveProgress: (progress: ReadingProgress) => void;
  getProgress: (mangaId: string) => ReadingProgress | undefined;
  isInLibrary: (mangaId: string) => boolean;
  getEntry: (mangaId: string) => LibraryEntry | undefined;
  totalChaptersRead: number;
  mergeImportedLibrary: (importedEntries: LibraryEntry[]) => Promise<void>;
}

const LibraryContext = createContext<LibraryContextType | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, ReadingProgress>>({});

  useEffect(() => {
    async function load() {
      try {
        const [libRaw, progRaw] = await Promise.all([
          AsyncStorage.getItem(LIBRARY_KEY),
          AsyncStorage.getItem(PROGRESS_KEY),
        ]);
        if (libRaw) setEntries(JSON.parse(libRaw));
        if (progRaw) setProgress(JSON.parse(progRaw));
      } catch {}
    }
    load();
  }, []);

  const saveEntries = useCallback(async (next: LibraryEntry[]) => {
    setEntries(next);
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
  }, []);

  const saveProgressMap = useCallback(
    async (next: Record<string, ReadingProgress>) => {
      setProgress(next);
      await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
    },
    []
  );

  const addToLibrary = useCallback(
    (manga: Manga, status: LibraryStatus) => {
      setEntries((prev) => {
        const exists = prev.find((e) => e.manga.id === manga.id);
        let next: LibraryEntry[];
        if (exists) {
          next = prev.map((e) => (e.manga.id === manga.id ? { ...e, status } : e));
        } else {
          next = [{ manga, status, addedAt: Date.now() }, ...prev];
        }
        AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const removeFromLibrary = useCallback(
    (mangaId: string) => {
      setEntries((prev) => {
        const next = prev.filter((e) => e.manga.id !== mangaId);
        AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const updateStatus = useCallback(
    (mangaId: string, status: LibraryStatus) => {
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.manga.id === mangaId ? { ...e, status } : e
        );
        AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const saveProgress = useCallback(
    (p: ReadingProgress) => {
      setProgress((prev) => {
        const next = { ...prev, [p.mangaId]: p };
        AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        return next;
      });
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.manga.id === p.mangaId
            ? { ...e, lastChapterId: p.chapterId, lastChapterNum: p.chapterNum }
            : e
        );
        AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const mergeImportedLibrary = useCallback(async (importedEntries: LibraryEntry[]) => {
    setEntries((prev) => {
      const byId = new Map(prev.map((entry) => [entry.manga.id, entry]));
      for (const entry of importedEntries) {
        if (!entry?.manga?.id || !entry.manga.title) continue;
        const existing = byId.get(entry.manga.id);
        byId.set(entry.manga.id, existing
          ? { ...existing, ...entry, manga: { ...existing.manga, ...entry.manga } }
          : entry);
      }
      const next = [...byId.values()].sort((a, b) => b.addedAt - a.addedAt);
      AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const getProgress = useCallback(
    (mangaId: string) => progress[mangaId],
    [progress]
  );

  const isInLibrary = useCallback(
    (mangaId: string) => entries.some((e) => e.manga.id === mangaId),
    [entries]
  );

  const getEntry = useCallback(
    (mangaId: string) => entries.find((e) => e.manga.id === mangaId),
    [entries]
  );

  const totalChaptersRead = Object.keys(progress).length;

  return (
    <LibraryContext.Provider
      value={{
        entries,
        progress,
        addToLibrary,
        removeFromLibrary,
        updateStatus,
        saveProgress,
        getProgress,
        isInLibrary,
        getEntry,
        totalChaptersRead,
        mergeImportedLibrary,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}
