import type { Book } from "../../storage/database";
import type { Chapter } from "../../types/manga-source";
import { compareChapterNumbers } from "../library/grouping";

export type ChapterFilter = "all" | "downloaded" | "available";
export type ChapterRow = { id: string; local?: Book; remote?: Chapter };

export function buildChapterRows({ chapters, books, sourceId, mangaId, language, filter }: {
  chapters: Chapter[]; books: Book[]; sourceId: string; mangaId: string;
  language: string | null; filter: ChapterFilter;
}): ChapterRow[] {
  const rows = new Map<string, ChapterRow>();

  for (const chapter of chapters) rows.set(chapter.id, { id: chapter.id, remote: chapter });

  for (const book of books) {
    if (book.source !== sourceId || book.sourceMangaId !== mangaId || !book.sourceChapterId) continue;

    rows.set(book.sourceChapterId, { ...rows.get(book.sourceChapterId), id: book.sourceChapterId, local: book });
  }

  return Array.from(rows.values()).filter((row) => {
    const locale = row.local?.chapterLanguage ?? row.remote?.language;

    if (language !== null && locale !== language) return false;
    if (filter === "downloaded") return !!row.local;
    if (filter === "available") return !row.local && !!row.remote && !row.remote.external && row.remote.pages > 0;

    return true;
  }).sort((a, b) => compareChapterNumbers(
    a.local?.chapterNumber ?? a.remote?.number, b.local?.chapterNumber ?? b.remote?.number,
  ) || (a.local?.chapterLanguage ?? a.remote?.language ?? "").localeCompare(b.local?.chapterLanguage ?? b.remote?.language ?? "") || a.id.localeCompare(b.id));
}
