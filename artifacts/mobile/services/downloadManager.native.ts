import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";

const DL_INDEX_KEY = "@mangaverse_dl_v1";

function baseDir(): string {
  return `${FileSystem.documentDirectory ?? ""}mv_downloads/`;
}

function chapterDir(sourceId: string, mangaId: string, chapterId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `${baseDir()}${safe(sourceId)}/${safe(mangaId)}/${safe(chapterId)}/`;
}

export interface DownloadRecord {
  mangaId: string;
  chapterId: string;
  chapterNum: string;
  mangaTitle: string;
  coverUrl: string;
  sourceId: string;
  pageCount: number;
  downloadedAt: number;
}

type DlIndex = Record<string, DownloadRecord>;

async function loadIndex(): Promise<DlIndex> {
  try {
    const raw = await AsyncStorage.getItem(DL_INDEX_KEY);
    return raw ? (JSON.parse(raw) as DlIndex) : {};
  } catch {
    return {};
  }
}

async function saveIndex(index: DlIndex): Promise<void> {
  await AsyncStorage.setItem(DL_INDEX_KEY, JSON.stringify(index));
}

export async function getDownloadedPages(
  sourceId: string,
  mangaId: string,
  chapterId: string
): Promise<string[] | null> {
  const index = await loadIndex();
  const record = index[chapterId];
  if (!record) return null;

  const dir = chapterDir(sourceId, mangaId, chapterId);
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) return null;

  const pages: string[] = [];
  for (let i = 0; i < record.pageCount; i++) {
    const path = `${dir}p${i}.jpg`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    pages.push(path);
  }
  return pages;
}

export async function downloadChapter(
  mangaId: string,
  chapterId: string,
  chapterNum: string,
  mangaTitle: string,
  coverUrl: string,
  sourceId: string,
  pages: string[],
  onProgress: (done: number, total: number) => void,
  signal?: { cancelled: boolean }
): Promise<void> {
  const dir = chapterDir(sourceId, mangaId, chapterId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  for (let i = 0; i < pages.length; i++) {
    if (signal?.cancelled) throw new Error("Download cancelled");
    const dest = `${dir}p${i}.jpg`;
    const existing = await FileSystem.getInfoAsync(dest);
    if (!existing.exists) {
      await FileSystem.downloadAsync(pages[i], dest);
    }
    onProgress(i + 1, pages.length);
  }

  const index = await loadIndex();
  index[chapterId] = {
    mangaId,
    chapterId,
    chapterNum,
    mangaTitle,
    coverUrl,
    sourceId,
    pageCount: pages.length,
    downloadedAt: Date.now(),
  };
  await saveIndex(index);
}

export async function deleteDownload(
  sourceId: string,
  mangaId: string,
  chapterId: string
): Promise<void> {
  const dir = chapterDir(sourceId, mangaId, chapterId);
  await FileSystem.deleteAsync(dir, { idempotent: true });
  const index = await loadIndex();
  delete index[chapterId];
  await saveIndex(index);
}

export async function listDownloads(): Promise<DownloadRecord[]> {
  const index = await loadIndex();
  return Object.values(index).sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export async function isChapterDownloaded(chapterId: string): Promise<boolean> {
  const index = await loadIndex();
  return !!index[chapterId];
}

export async function getDownloadedSizeMB(): Promise<number> {
  try {
    const dir = baseDir();
    const info = await FileSystem.getInfoAsync(dir, { size: true });
    if (!info.exists) return 0;
    const sizeBytes = (info as FileSystem.FileInfo & { size?: number }).size ?? 0;
    return Math.round((sizeBytes / 1024 / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}
