import test from "node:test";
import assert from "node:assert/strict";
import type { Book } from "../src/storage/database.ts";
import type { Chapter } from "../src/types/manga-source.ts";
import { buildChapterRows } from "../src/features/catalog/chapter-list.ts";
import { loadLocalManga } from "../src/services/manga-library.ts";
import { nativeDownloadHarness } from "./helpers/native-download.ts";

function remote(id: string, number: string, extra: Partial<Chapter> = {}): Chapter {
  return { id, number, title: "", volume: "1", language: "pt-br", pages: 48, groups: ["Equipe"], external: false, ...extra };
}

function saved(id: string, number: string, extra: Partial<Book> = {}): Book {
  return {
    id: `local-${id}`, sourceChapterId: id, source: "mangadex", sourceMangaId: "manga",
    title: `Naruto · ${number}`, mangaTitle: "Naruto", chapterNumber: number, chapterLanguage: "pt-br",
    pages: 48, page: 7, mode: "vertical", accessed: 10, cover: "file:///cover.png", ...extra,
  };
}

test("une baixados e catálogo pelo ID do capítulo, incluindo locais fora da página da API", () => {
  const books = [saved("one", "1"), saved("late", "150"), saved("foreign", "2", { sourceMangaId: "other" }), saved("wrong-source", "3", { source: "other" })];
  const chapters = [remote("one", "1"), remote("two", "2"), remote("two", "2")];
  const before = JSON.stringify({ books, chapters });
  const rows = buildChapterRows({ books, chapters, sourceId: "mangadex", mangaId: "manga", language: null, filter: "all" });
  assert.deepEqual(rows.map((row) => row.id), ["one", "two", "late"]);
  assert.equal(rows[0].local?.page, 7);
  assert.ok(rows[0].remote);
  assert.equal(rows[2].remote, undefined);
  assert.equal(JSON.stringify({ books, chapters }), before);
});

test("filtros preservam versões de tradução e oferecem download apenas de capítulos elegíveis", () => {
  const books = [saved("pt", "1"), saved("en", "1", { chapterLanguage: "en" })];
  const chapters = [remote("pt", "1"), remote("new", "2"), remote("external", "3", { external: true }), remote("empty", "4", { pages: 0 })];
  const params = { books, chapters, sourceId: "mangadex", mangaId: "manga", language: null };
  assert.deepEqual(buildChapterRows({ ...params, filter: "downloaded" }).map((row) => row.id).sort(), ["en", "pt"]);
  assert.deepEqual(buildChapterRows({ ...params, language: "pt-br", filter: "downloaded" }).map((row) => row.id), ["pt"]);
  assert.deepEqual(buildChapterRows({ ...params, filter: "available" }).map((row) => row.id), ["new"]);
  assert.equal(buildChapterRows({ ...params, filter: "all" }).length, 5);
});

test("baixados funcionam sem catálogo e remover um local torna a versão remota disponível", () => {
  const params = { books: [saved("one", "1")], chapters: [] as Chapter[], sourceId: "mangadex", mangaId: "manga", language: null };
  assert.equal(buildChapterRows({ ...params, filter: "downloaded" }).length, 1);
  const after = buildChapterRows({ ...params, books: [], chapters: [remote("one", "1")], filter: "available" });
  assert.equal(after.length, 1);
  assert.equal(after[0].local, undefined);
});

test("carrega detalhes locais e sinopse salva sem depender de rede", async () => {
  const h = await nativeDownloadHarness();

  try {
    h.sqlite.prepare("INSERT INTO books(id,title,pages,page,mode,accessed,cover,source,sourceChapterId,sourceMangaId,mangaTitle,chapterNumber,chapterLanguage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("local", "Naruto · Cap. 1", 48, 7, "vertical", 10, "file:///cover.png", "mangadex", "chapter", "manga", "Naruto", "1", "pt-br");
    const request = JSON.stringify({ manga: { id: "manga", title: "Naruto", description: "Sinopse disponível offline", status: "completed", year: 1999, languages: ["pt-br", "en"] }, chapter: { id: "chapter", number: "1", language: "pt-br" } });
    h.sqlite.prepare("INSERT INTO downloads(chapterId,request,status,bookId,updatedAt) VALUES (?,?,?,?,0)").run("chapter", request, "completed", "local");
    const data = await loadLocalManga(h.db, "mangadex", "manga");
    assert.equal(data.books.length, 1);
    assert.equal(data.books[0].page, 7);
    assert.equal(data.books[0].mode, "vertical");
    assert.equal(data.cover, "file:///cover.png");
    assert.equal(data.manga?.description, "Sinopse disponível offline");
    assert.equal(data.manga?.year, 1999);
    h.sqlite.prepare("UPDATE downloads SET request='invalid-json'").run();
    const fallback = await loadLocalManga(h.db, "mangadex", "manga");
    assert.equal(fallback.books.length, 1);
    assert.equal(fallback.manga?.title, "Naruto");
    assert.equal(fallback.manga?.description, "");
    assert.equal((await loadLocalManga(h.db, "mangadex", "other")).manga, null);
    assert.equal((await loadLocalManga(h.db, "other-source", "manga")).books.length, 0);
  } finally {
    h.sqlite.close();
  }
});
