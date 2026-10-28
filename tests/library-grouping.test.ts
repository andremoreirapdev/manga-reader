import test from "node:test";
import assert from "node:assert/strict";
import type { Book } from "../src/storage/database.ts";
import { groupBooks, selectMangas } from "../src/features/library/grouping.ts";
import { metadataFromDownload } from "../src/storage/book-metadata.ts";

function chapter(id: string, number: string | null, extra: Partial<Book> = {}): Book {
  return {
    id, title: `Naruto · Cap. ${number ?? "especial"} · pt-br`, pages: 10, page: 0, mode: "paged",
    accessed: 10, cover: `file:///${id}.png`, source: "mangadex", sourceChapterId: id,
    sourceMangaId: "manga-one", mangaTitle: "Naruto", chapterNumber: number, chapterLanguage: "pt-br", ...extra,
  };
}

test("agrupa pelo ID da obra e fonte, preservando traduções e títulos iguais de obras distintas", () => {
  const books = [
    chapter("two", "2"), chapter("one", "1"),
    chapter("english", "1", { chapterLanguage: "en" }),
    chapter("another-work", "1", { sourceMangaId: "manga-two" }),
    chapter("another-source", "1", { source: "another-source" }),
  ];
  const before = JSON.stringify(books);
  const mangas = groupBooks(books);
  assert.equal(mangas.length, 3);
  const naruto = mangas.find((manga) => manga.chapters.some((book) => book.id === "two"))!;
  assert.equal(naruto.title, "Naruto");
  assert.equal(naruto.chapters.length, 3);
  assert.equal(naruto.pages, 30);
  assert.deepEqual(naruto.chapters.map((book) => book.id), ["english", "one", "two"]);
  assert.equal(JSON.stringify(books), before);
});

test("não adivinha relações entre CBZs ou capítulos sem identidade de obra", () => {
  const books = [
    chapter("cbz-one", "1", { source: "cbz", title: "Mesmo nome" }),
    chapter("cbz-two", "2", { source: "cbz", title: "Mesmo nome" }),
    chapter("legacy", "1", { sourceMangaId: null, mangaTitle: null }),
  ];
  const mangas = groupBooks(books);
  assert.equal(mangas.length, 3);
  assert.ok(mangas.every((manga) => !manga.isSeries && manga.chapters.length === 1));
});

test("ordena capítulos numericamente e prioriza a leitura em andamento sobre um download recente", () => {
  const books = [
    chapter("ten", "10", { accessed: 999 }),
    chapter("two", "2", { page: 6, accessed: 100 }),
    chapter("fraction", "2.5"), chapter("one", "1", { page: 3, accessed: 50 }),
    chapter("special", null),
  ];
  const manga = groupBooks(books)[0];
  assert.deepEqual(manga.chapters.map((book) => book.chapterNumber), ["1", "2", "2.5", "10", null]);
  assert.equal(manga.resume.id, "two");
  assert.equal(manga.resume.page, 6);
  assert.equal(manga.cover, "file:///one.png");
  assert.equal(manga.accessed, 999);
  assert.equal(manga.inProgress, true);
});

test("sem leitura intermediária escolhe o primeiro não iniciado, e preserva o grupo após remover capítulo", () => {
  const books = [chapter("one", "1", { page: 9 }), chapter("two", "2"), chapter("three", "3")];
  const manga = groupBooks(books)[0];
  assert.equal(manga.resume.id, "two");
  const remaining = groupBooks(books.slice(1))[0];
  assert.equal(remaining.id, manga.id);
  assert.equal(remaining.chapters.length, 2);
  assert.equal(remaining.resume.id, "two");
  assert.deepEqual(groupBooks([]), []);
});

test("busca, filtro e contagem operam sobre obras sem excluir capítulos do grupo", () => {
  const mangas = groupBooks([
    chapter("one", "1", { mangaTitle: "Ação", page: 4 }), chapter("two", "2", { mangaTitle: "Ação" }),
    chapter("other", "1", { sourceMangaId: "other", mangaTitle: "Volume 10", title: "Outro" }),
    chapter("last", "1", { sourceMangaId: "last", mangaTitle: "Volume 2", title: "Último" }),
  ]);
  assert.equal(selectMangas(mangas, " ACAO ", "all", "recent")[0].chapters.length, 2);
  assert.equal(selectMangas(mangas, "", "reading", "recent").length, 1);
  assert.deepEqual(selectMangas(mangas, "", "all", "title").map((manga) => manga.title), ["Ação", "Volume 2", "Volume 10"]);
  assert.equal(selectMangas(mangas, "pt-br", "all", "recent")[0].chapters.length, 2);
});

test("recupera metadados antigos somente de solicitações válidas do mesmo capítulo", () => {
  const request = JSON.stringify({ manga: { id: "manga-one", title: "Naruto" }, chapter: { id: "chapter", number: "2", language: "pt-br" } });
  assert.equal(metadataFromDownload(request, "chapter")?.sourceMangaId, "manga-one");
  assert.equal(metadataFromDownload(request, "wrong"), null);

  for (const value of ["invalid-json", "null", "[]", "{}", '{"manga":{"id":"","title":"Naruto"},"chapter":{"id":"chapter"}}']) {
    assert.equal(metadataFromDownload(value, "chapter"), null);
  }
});
