import test from "node:test";
import assert from "node:assert/strict";
import {
  runChapterDownload,
  DownloadError,
  checkCanceled,
  waitForDownload,
  type ChapterStorage,
  type DownloadRequest,
} from "../src/features/downloads/engine.ts";
import type { ChapterPages, MangaSource } from "../src/types/manga-source.ts";

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
    id: "chapter",
    title: "Teste",
    number: "1",
    volume: "1",
    language: "pt-br",
    pages: 2,
    groups: ["Grupo sintético"],
    external: false,
  },
};
const manifest: ChapterPages = {
  revision: "version-a",
  expiresAt: Date.now() + 600000,
  pages: [
    { url: "https://example.test/10.png", extension: "png" },
    { url: "https://example.test/2.png", extension: "png" },
  ],
};
const noWait = async () => {};

test("páginas bem-sucedidas não inserem pausas artificiais", async () => {
  const { storage, source } = setup();
  let clock = 0;
  const pauses: number[] = [];
  await runChapterDownload(request, source, storage, new AbortController().signal,
    () => {}, async (milliseconds) => { clock += milliseconds; },
    () => clock, (milliseconds) => pauses.push(milliseconds),
  );
  assert.deepEqual(pauses, []);
  assert.equal(clock, 0);
});

function setup() {
  const events: string[] = [];
  const storage: ChapterStorage = {
    async setTotal(total) {
      assert.equal(total, 2);
    },
    async begin() {
      events.push("begin");
    },
    async writePage(index, page) {
      events.push(page.url);
      return { name: `page-${index}.png`, bytes: 10, width: 1, height: 1 };
    },
    async publish(pages) {
      events.push(`publish:${pages.length}`);
      return "local-book";
    },
    async rollback() {
      events.push("rollback");
    },
  };
  const source = {
    async getChapterPages() {
      events.push("manifest");
      return manifest;
    },
  } as unknown as MangaSource;

  return { events, storage, source };
}

test("download mantém ordem da fonte e só publica quando todas as páginas terminam", async () => {
  const { events, storage, source } = setup();
  const progress: number[] = [];
  const book = await runChapterDownload(
    request,
    source,
    storage,
    new AbortController().signal,
    (value) => progress.push(value.completed),
    noWait,
  );
  assert.equal(book, "local-book");
  assert.deepEqual(events, [
    "begin",
    "manifest",
    "https://example.test/10.png",
    "https://example.test/2.png",
    "publish:2",
  ]);
  assert.equal(progress.at(-1), 2);
});

test("falha transitória faz tentativa limitada e pede novo servidor à fonte", async () => {
  const { events, storage, source } = setup();
  const original = storage.writePage;
  let attempts = 0;
  storage.writePage = async (...args) => {
    if (attempts++ === 0) throw new DownloadError("HTTP 503", true);

    return original(...args);
  };
  await runChapterDownload(
    request,
    source,
    storage,
    new AbortController().signal,
    () => {},
    noWait,
  );
  assert.equal(attempts, 3);
  assert.equal(events.filter((value) => value === "manifest").length, 2);
});

test("recusa de acesso não é repetida e a tentativa incompleta é removida", async () => {
  const { events, storage, source } = setup();
  let attempts = 0;
  storage.writePage = async () => {
    attempts++;
    throw new DownloadError("HTTP 403");
  };
  await assert.rejects(
    runChapterDownload(
      request,
      source,
      storage,
      new AbortController().signal,
      () => {},
      noWait,
    ),
    /403/,
  );
  assert.equal(attempts, 1);
  assert.equal(events.at(-1), "rollback");
  assert.ok(!events.some((event) => event.startsWith("publish")));
});

test("cancelamento entre páginas faz limpeza e não publica", async () => {
  const { events, storage, source } = setup();
  const controller = new AbortController();
  const original = storage.writePage;
  storage.writePage = async (...args) => {
    const page = await original(...args);
    controller.abort();
    return page;
  };
  await assert.rejects(
    runChapterDownload(
      request,
      source,
      storage,
      controller.signal,
      () => {},
      noWait,
    ),
    { name: "AbortError" },
  );
  assert.equal(events.at(-1), "rollback");
  assert.ok(!events.some((event) => event.startsWith("publish")));
});

test("limita a três tentativas e não mistura revisões de capítulos", async () => {
  const { storage, source, events } = setup();
  let attempts = 0;
  let clock = 0;
  const waits: number[] = [];
  const measured: number[] = [];
  storage.writePage = async () => {
    attempts++;
    throw new DownloadError("Sem rede", true);
  };
  await assert.rejects(
    runChapterDownload(
      request,
      source,
      storage,
      new AbortController().signal,
      () => {},
      async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
      () => clock,
      (milliseconds) => measured.push(milliseconds),
    ),
    /Sem rede/,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [2000, 4000]);
  assert.deepEqual(measured, waits);
  let requests = 0;
  source.getChapterPages = async () => ({
    ...manifest,
    revision: requests++ === 0 ? "version-a" : "version-b",
  });
  await assert.rejects(
    runChapterDownload(
      request,
      source,
      storage,
      new AbortController().signal,
      () => {},
      noWait,
    ),
    /mudou/,
  );
  assert.equal(events.at(-1), "rollback");
});

test("renova manifesto vencido e limpa arquivos quando a publicação falha", async () => {
  const { storage, source, events } = setup();
  storage.publish = async () => {
    throw new Error("Falha SQLite");
  };
  await assert.rejects(
    runChapterDownload(
      request,
      source,
      storage,
      new AbortController().signal,
      () => {},
      noWait,
      () => manifest.expiresAt + 1,
    ),
    /SQLite/,
  );
  assert.equal(events.filter((value) => value === "manifest").length, 3);
  assert.equal(events.at(-1), "rollback");
});

test("espera entre tentativas responde ao cancelamento sem esperar o timer", async () => {
  const controller = new AbortController();
  const waiting = waitForDownload(60000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.throws(() => checkCanceled(controller.signal), { name: "AbortError" });
});
