import type { Book } from "../../storage/database";

export type LibraryFilter = "all" | "reading";
export type LibrarySort = "recent" | "title";

export function readingPosition(book: Book) {
  const pages = Math.max(1, book.pages);
  const page = Math.max(0, Math.min(pages - 1, book.page));

  return { page: page + 1, percent: Math.round(((page + 1) / pages) * 100) };
}

export function isInProgress(book: Book) {
  return book.page > 0 && book.page < book.pages - 1;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function selectBooks(
  books: Book[],
  query: string,
  filter: LibraryFilter,
  sort: LibrarySort,
) {
  const search = normalize(query.trim());
  const selected = books.filter(
    (book) =>
      normalize(book.title).includes(search) &&
      (filter === "all" || isInProgress(book)),
  );

  return selected.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title, "pt-BR", {
          numeric: true,
          sensitivity: "base",
        }) || b.accessed - a.accessed
      : b.accessed - a.accessed || a.id.localeCompare(b.id),
  );
}
