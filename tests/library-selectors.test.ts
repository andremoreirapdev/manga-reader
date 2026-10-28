import test from "node:test";
import assert from "node:assert/strict";
import type { Book } from "../src/storage/database.ts";
import {
  isInProgress,
  readingPosition,
  selectBooks,
} from "../src/features/library/selectors.ts";

function book(
  id: string,
  title: string,
  page = 0,
  accessed = 0,
  pages = 100,
): Book {
  return {
    id,
    title,
    page,
    accessed,
    pages,
    mode: "paged",
    cover: "file:///cover.png",
  };
}

test("busca local ignora acentos, espaços externos e diferenças de caixa", () => {
  const books = [book("1", "Ação e aventura"), book("2", "Outro título")];
  assert.deepEqual(
    selectBooks(books, " ACAO ", "all", "recent").map((item) => item.id),
    ["1"],
  );
  assert.deepEqual(selectBooks(books, "inexistente", "all", "recent"), []);
});

test("filtra leituras intermediárias sem confundir primeira ou última página", () => {
  const books = [
    book("first", "Primeiro", 0),
    book("reading", "Em leitura", 35),
    book("last", "Último", 99),
    book("single", "Página única", 0, 0, 1),
  ];
  assert.deepEqual(
    selectBooks(books, "", "reading", "recent").map((item) => item.id),
    ["reading"],
  );
  assert.equal(isInProgress(books[3]), false);
});

test("ordena por acesso ou título com números e preserva a coleção original", () => {
  const books = [book("2", "Volume 10", 10, 20), book("1", "Volume 2", 5, 10)];
  assert.deepEqual(
    selectBooks(books, "", "all", "recent").map((item) => item.id),
    ["2", "1"],
  );
  assert.deepEqual(
    selectBooks(books, "", "all", "title").map((item) => item.id),
    ["1", "2"],
  );
  assert.deepEqual(
    books.map((item) => item.id),
    ["2", "1"],
  );
});

test("posição exibida usa página humana e permanece dentro dos limites", () => {
  assert.deepEqual(readingPosition(book("1", "Teste", 49)), {
    page: 50,
    percent: 50,
  });
  assert.deepEqual(readingPosition(book("1", "Teste", 999)), {
    page: 100,
    percent: 100,
  });
  assert.deepEqual(readingPosition(book("1", "Teste", -1)), {
    page: 1,
    percent: 1,
  });
});
