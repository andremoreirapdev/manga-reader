import type { SQLiteDatabase } from "expo-sqlite";
import type { Book } from "../storage/database";
import type { Manga } from "../types/manga-source";
import { metadataFromDownload } from "../storage/book-metadata";
import { groupBooks } from "../features/library/grouping";

/** Metadados e capítulos locais independentes da disponibilidade da API. */
export async function loadLocalManga(db: SQLiteDatabase, source: string, id: string) {
  const books = await db.getAllAsync<Book>(
    "SELECT * FROM books WHERE source=? AND sourceMangaId=? ORDER BY accessed DESC", source, id,
  );
  const group = groupBooks(books)[0];

  if (!group) return { books, manga: null, cover: null };

  let manga: Manga = {
    id, title: group.title, description: "", coverUrl: null, status: "", year: null,
    languages: [...new Set(books.map((book) => book.chapterLanguage).filter((language): language is string => !!language))],
  };

  try {
    const previous = await db.getFirstAsync<{ request: string; sourceChapterId: string }>(
      "SELECT d.request,b.sourceChapterId FROM books b JOIN downloads d ON d.bookId=b.id AND d.chapterId=b.sourceChapterId WHERE b.source=? AND b.sourceMangaId=? ORDER BY b.accessed DESC LIMIT 1", source, id,
    );

    if (previous && metadataFromDownload(previous.request, previous.sourceChapterId)?.sourceMangaId === id) {
      const value = JSON.parse(previous.request).manga;
      manga = {
        ...manga,
        description: typeof value.description === "string" ? value.description : "",
        status: typeof value.status === "string" ? value.status : "",
        year: typeof value.year === "number" && Number.isFinite(value.year) ? value.year : null,
        languages: Array.isArray(value.languages) ? value.languages.filter((language: unknown): language is string => typeof language === "string") : manga.languages,
      };
    }
  } catch {
    // Uma sinopse ausente/corrompida não impede a leitura dos capítulos salvos.
  }

  return { books, manga, cover: group.cover };
}
