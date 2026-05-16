export type MangaStatus = "ongoing" | "completed" | "hiatus" | "cancelled";

export interface Manga {
  id: string;
  title: string;
  coverUrl: string;
  sourceId: string;
  status?: MangaStatus;
  rating?: number;
  description?: string;
  genres?: string[];
  author?: string;
  altTitles?: string[];
  year?: number;
  contentRating?: string;
  chaptersCount?: number;
}

export interface Chapter {
  id: string;
  number: string;
  title?: string;
  publishedAt: string;
  scanlator?: string;
  pages?: number;
  translatedLanguage?: string;
}

export interface MangaSource {
  id: string;
  name: string;
  baseUrl: string;
  isEnabled: boolean;
  search(query: string, page?: number): Promise<Manga[]>;
  getTrending(page?: number): Promise<Manga[]>;
  getLatestUpdates(page?: number): Promise<Manga[]>;
  getMangaDetails(id: string): Promise<Manga>;
  getChapters(mangaId: string): Promise<Chapter[]>;
  getChapterPages(chapterId: string): Promise<string[]>;
}

export type LibraryStatus = "reading" | "completed" | "planned" | "favorites";

export interface LibraryEntry {
  manga: Manga;
  status: LibraryStatus;
  lastChapterId?: string;
  lastChapterNum?: string;
  addedAt: number;
}

export interface ReadingProgress {
  mangaId: string;
  chapterId: string;
  chapterNum: string;
  pageIndex: number;
  timestamp: number;
}
