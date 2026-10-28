export type Manga = {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  status: string;
  year: number | null;
  languages: string[];
};

export type Chapter = {
  id: string;
  title: string;
  number: string | null;
  volume: string | null;
  language: string;
  pages: number;
  groups: string[];
  external: boolean;
};

export type SourcePage<T> = {
  items: T[];
  total: number;
  nextOffset: number | null;
};

export type PageRequest = { offset?: number; signal?: AbortSignal };

export type ChapterPages = {
  revision: string;
  expiresAt: number;
  pages: { url: string; extension: string }[];
};

export type PageReport = {
  url: string;
  success: boolean;
  bytes: number;
  duration: number;
  cached: boolean;
};

export interface MangaSource {
  readonly id: string;
  readonly name: string;
  search(title: string, request?: PageRequest): Promise<SourcePage<Manga>>;
  getManga(id: string, signal?: AbortSignal): Promise<Manga>;
  getChapterPages(id: string, signal?: AbortSignal): Promise<ChapterPages>;
  reportPage?(report: PageReport): Promise<void>;
  chapters(
    id: string,
    language: string | null,
    request?: PageRequest,
  ): Promise<SourcePage<Chapter>>;
}
