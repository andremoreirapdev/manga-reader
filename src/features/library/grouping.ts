import type { Book } from "../../storage/database";
import { isInProgress, normalizeLibraryText, type LibraryFilter, type LibrarySort } from "./selectors";

export type LibraryManga = {
  id: string;
  title: string;
  source: string;
  isSeries: boolean;
  chapters: Book[];
  resume: Book;
  cover: string;
  pages: number;
  accessed: number;
  inProgress: boolean;
};
export type LibraryRow =
  | { kind: "manga"; id: string; manga: LibraryManga }
  | { kind: "chapter"; id: string; book: Book; last: boolean };

function compareChapters(a: Book, b: Book) {
  const first = a.chapterNumber;
  const second = b.chapterNumber;

  if (!first && second) return 1;
  if (first && !second) return -1;

  if (first && second && /^\d+(\.\d+)?$/.test(first) && /^\d+(\.\d+)?$/.test(second)) {
    const difference = Number(first) - Number(second);

    if (Number.isFinite(difference) && difference !== 0) return difference;
  }

  return (first ?? "").localeCompare(second ?? "", "pt-BR", { numeric: true }) ||
    (a.chapterLanguage ?? "").localeCompare(b.chapterLanguage ?? "") ||
    a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id);
}

export function groupBooks(books: Book[]): LibraryManga[] {
  const groups = new Map<string, Book[]>();

  for (const book of books) {
    const series = book.source && book.source !== "cbz" && book.sourceMangaId && book.mangaTitle;
    const id = series ? `manga:${JSON.stringify([book.source, book.sourceMangaId])}` : `book:${book.id}`;
    const group = groups.get(id) ?? [];
    group.push(book);
    groups.set(id, group);
  }

  return Array.from(groups, ([id, group]) => {
    const chapters = [...group].sort(compareChapters);
    const recent = [...group].sort((a, b) => b.accessed - a.accessed || a.id.localeCompare(b.id));
    const reading = recent.filter(isInProgress);
    const resume = reading[0] ?? chapters.find((chapter) => chapter.page === 0) ?? recent[0];
    const isSeries = id.startsWith("manga:");

    return {
      id,
      title: isSeries ? recent[0].mangaTitle! : recent[0].title,
      source: recent[0].source ?? "cbz",
      isSeries,
      chapters,
      resume,
      cover: chapters[0].cover,
      pages: chapters.reduce((total, chapter) => total + chapter.pages, 0),
      accessed: recent[0].accessed,
      inProgress: reading.length > 0,
    };
  });
}

export function selectMangas(mangas: LibraryManga[], query: string, filter: LibraryFilter, sort: LibrarySort) {
  const search = normalizeLibraryText(query.trim());

  return mangas.filter((manga) =>
    (normalizeLibraryText(manga.title).includes(search) ||
      manga.chapters.some((book) => normalizeLibraryText(book.title).includes(search))) &&
    (filter === "all" || manga.inProgress),
  ).sort((a, b) => sort === "title"
    ? a.title.localeCompare(b.title, "pt-BR", { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)
    : b.accessed - a.accessed || a.id.localeCompare(b.id),
  );
}

/** Uma FlatList única virtualiza tanto os mangás quanto os capítulos expandidos. */
export function libraryRows(mangas: LibraryManga[], expanded: ReadonlySet<string>): LibraryRow[] {
  return mangas.flatMap((manga): LibraryRow[] => [
    { kind: "manga", id: manga.id, manga },
    ...(manga.isSeries && expanded.has(manga.id) ? manga.chapters.map((book, index): LibraryRow => ({
      kind: "chapter", id: `chapter:${book.id}`, book, last: index === manga.chapters.length - 1,
    })) : []),
  ]);
}
