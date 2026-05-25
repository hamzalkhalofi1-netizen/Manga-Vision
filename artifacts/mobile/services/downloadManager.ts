// Web stub — Metro will prefer downloadManager.native.ts on iOS/Android.
// All functions are no-ops or return empty values on web.

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

export async function getDownloadedPages(
  _sourceId: string,
  _mangaId: string,
  _chapterId: string
): Promise<string[] | null> {
  return null;
}

export async function downloadChapter(
  _mangaId: string,
  _chapterId: string,
  _chapterNum: string,
  _mangaTitle: string,
  _coverUrl: string,
  _sourceId: string,
  _pages: string[],
  _onProgress: (done: number, total: number) => void,
  _signal?: { cancelled: boolean }
): Promise<void> {
  throw new Error("Downloads are only available in the mobile app.");
}

export async function deleteDownload(
  _sourceId: string,
  _mangaId: string,
  _chapterId: string
): Promise<void> {}

export async function listDownloads(): Promise<DownloadRecord[]> {
  return [];
}

export async function isChapterDownloaded(_chapterId: string): Promise<boolean> {
  return false;
}

export async function getDownloadedSizeMB(): Promise<number> {
  return 0;
}
