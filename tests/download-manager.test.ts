import test from "node:test";
import assert from "node:assert/strict";
import { nativeDownloadHarness } from "./helpers/native-download.ts";
import type { DownloadRequest } from "../src/features/downloads/engine.ts";
import type { MangaSource } from "../src/types/manga-source.ts";

const chapterId = "22222222-2222-4222-8222-222222222222";
const request: DownloadRequest = {
  manga: {
    id: "manga",
    title: "Teste sintético",
    description: "",
    coverUrl: null,
    status: "completed",
    year: null,
    languages: ["pt-br"],
  },
  chapter: {
    id: chapterId,
    title: "Teste",
    number: "1",
    volume: "1",
    language: "pt-br",
    pages: 2,
    groups: ["Equipe de teste"],
    external: false,
  },
};
const source = {
  id: "mangadex",
  name: "MangaDex",
  async getChapterPages() {
    return {
      revision: "a",
      expiresAt: Date.now() + 60000,
      pages: [
        { url: "https://test.example/1.png", extension: "png" },
        { url: "https://test.example/2.png", extension: "png" },
      ],
    };
  },
} as unknown as MangaSource;

test("download integrado publica páginas, dimensões e créditos e evita duplicação", async () => {
  const h = await nativeDownloadHarness();
  let reportCalls = 0;

  try {
    const manager = h.createManager(h.db, {
      ...source,
      async reportPage() { reportCalls++; },
    });
    await manager.start(request);
    const job = manager.getSnapshot().jobs[chapterId];
    assert.equal(job.status, "completed", job.error ?? "");
    assert.match(job.diagnostics ?? "", /Tentativas de página: 2/);
    assert.match(job.diagnostics ?? "", /Servidor.*Gravação/s);
    assert.match(job.diagnostics ?? "", /Processamento completo das páginas:/);
    assert.match(job.diagnostics ?? "", /Criação\/abertura:/);
    assert.equal(reportCalls, 2, "deve enviar um relatório para cada página recebida");
    assert.match(job.diagnostics ?? "", /Relatórios: ativados\./);
    assert.match(job.diagnostics ?? "", /2 páginas em buffer nativo/);
    const book = h.sqlite.prepare("SELECT * FROM books").get();
    assert.equal(book?.sourceChapterId, chapterId);
    assert.match(String(book?.credits), /MangaDex.*Equipe de teste/);
    const pagesUri = `file:///private/library/${job.bookId}/pages.json`;
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(h.files.get(pagesUri))),
      ["page-00001.png", "page-00002.png"],
    );
    assert.ok(h.files.has(String(book?.cover)));
    assert.ok(![...h.files.keys()].some((name) => name.endsWith(".part")));
    await manager.start(request);
    assert.equal(reportCalls, 2, "capítulo já salvo não deve gerar novos envios");
    assert.equal(
      h.sqlite.prepare("SELECT COUNT(*) AS count FROM books").get()?.count,
      1,
    );
    assert.equal(manager.getSnapshot().jobs[chapterId].bookId, job.bookId);
  } finally {
    h.sqlite.close();
  }
});

test("falha no commit desfaz metadados e limpa páginas já movidas", async () => {
  const h = await nativeDownloadHarness();

  try {
    h.setFailPublish(true);
    const manager = h.createManager(h.db, source);
    await manager.start(request);
    assert.equal(manager.getSnapshot().jobs[chapterId].status, "failed");
    assert.equal(
      h.sqlite.prepare("SELECT COUNT(*) AS count FROM books").get()?.count,
      0,
    );
    assert.equal(h.files.size, 0);
    assert.equal(
      h.sqlite.prepare("SELECT status FROM downloads").get()?.status,
      "failed",
    );
  } finally {
    h.sqlite.close();
  }
});

test("reinício marca tentativa pendente como interrompida e remove arquivos órfãos", async () => {
  const h = await nativeDownloadHarness();
  const bookId = "11111111-1111-4111-8111-111111111111";

  try {
    h.sqlite
      .prepare(
        "INSERT INTO downloads (chapterId,request,status,bookId,updatedAt) VALUES (?,?,?,?,?)",
      )
      .run(chapterId, JSON.stringify(request), "downloading", bookId, 1);
    h.directories.add(`file:///private/download-staging/${bookId}`);
    h.files.set(
      `file:///private/download-staging/${bookId}/unfinished.part`,
      new Uint8Array(3),
    );
    h.directories.add(`file:///private/library/${bookId}`);
    h.files.set(
      `file:///private/library/${bookId}/orphan.png`,
      new Uint8Array(3),
    );
    const manager = h.createManager(h.db, source);
    await manager.initialize();
    assert.equal(h.files.size, 0);
    assert.equal(manager.getSnapshot().jobs[chapterId].status, "interrupted");
    assert.equal(
      h.sqlite.prepare("SELECT status FROM downloads").get()?.status,
      "interrupted",
    );
  } finally {
    h.sqlite.close();
  }
});

test("cancelar transferência ativa fecha a tentativa sem publicar biblioteca", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = await nativeDownloadHarness(async (_url, options) => {
    entered();

    return new Promise((_resolve, reject) =>
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      ),
    );
  });

  try {
    const manager = h.createManager(h.db, source);
    const downloading = manager.start(request);
    await started;
    manager.cancel();
    await downloading;
    assert.equal(manager.getSnapshot().jobs[chapterId].status, "cancelled");
    assert.equal(h.files.size, 0);
    assert.equal(
      h.sqlite.prepare("SELECT COUNT(*) AS count FROM books").get()?.count,
      0,
    );
  } finally {
    h.sqlite.close();
  }
});
