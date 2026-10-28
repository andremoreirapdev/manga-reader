import test from "node:test";
import assert from "node:assert/strict";
import { receivePage } from "../src/services/downloads/transfer.ts";
import { DownloadError } from "../src/features/downloads/engine.ts";
import { validateDownloadedImage } from "../src/features/downloads/validation.ts";
import type { PageReport } from "../src/types/manga-source.ts";

function sink() {
  const writes: number[] = [];
  let closed = 0;

  return {
    writes,
    get closed() {
      return closed;
    },
    open: () => ({
      async write(bytes: Uint8Array) {
        writes.push(bytes.length);
      },
      close() {
        closed++;
      },
    }),
  };
}

test("lê metadados nativos uma única vez e mede também a preparação do stream", async (context) => {
  let clock = 100;
  context.mock.method(Date, "now", () => clock);
  const calls = { url: 0, status: 0, headers: 0, body: 0 };
  const measured = new Map<string, number>();
  const payload = new Response(new Uint8Array(3));
  const headers = new Headers({ "content-type": "image/png", "content-length": "3" });
  const file = sink();
  const count = await receivePage(
    "https://node.example/image",
    new AbortController().signal,
    100,
    async () => ({
      get url() {
        calls.url++;
        clock += 1000;

        return "https://node.example/image";
      },
      get status() {
        calls.status++;
        clock += 1000;

        return 200;
      },
      get headers() {
        calls.headers++;
        clock += 2000;

        return headers;
      },
      get body() {
        calls.body++;
        clock += 500;

        return payload.body;
      },
      get ok(): boolean {
        throw new Error("ok repete acesso ao status nativo; use o snapshot");
      },
    }),
    file.open,
    () => {},
    undefined,
    (stage, duration) => measured.set(stage, (measured.get(stage) ?? 0) + duration),
  );
  assert.equal(count, 3);
  assert.deepEqual(calls, { url: 1, status: 1, headers: 1, body: 1 });
  assert.equal(measured.get("metadataMs"), 4000);
  assert.equal(measured.get("bodySetupMs"), 500);
  assert.equal(measured.get("headersMs"), 0);
});

test("mede criação de arquivo e enfileiramento antes ausentes do diagnóstico", async (context) => {
  let clock = 100;
  context.mock.method(Date, "now", () => clock);
  const measured = new Map<string, number>();
  const count = await receivePage(
    "https://node.example/image",
    new AbortController().signal,
    100,
    async () => new Response(new Uint8Array(3), {
      headers: { "content-type": "image/png" },
    }),
    () => {
      clock += 700;

      return { async write() {}, close() {} };
    },
    () => {},
    async () => { clock += 5000; },
    (stage, duration) => measured.set(stage, (measured.get(stage) ?? 0) + duration),
  );
  assert.equal(count, 3);
  assert.equal(measured.get("fileOpenMs"), 700);
  assert.equal(measured.get("reportEnqueueMs"), 5000);
  assert.equal(measured.get("headersMs"), 0);
});

test("transfere em blocos para disco e relata bytes e cache do servidor", async () => {
  const file = sink();
  const reports: PageReport[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3));
      controller.enqueue(new Uint8Array(4));
      controller.close();
    },
  });
  const count = await receivePage(
    "https://node.example/image",
    new AbortController().signal,
    100,
    async (_url, options) => {
      assert.equal(options.redirect, "follow");
      assert.ok(!("Authorization" in options.headers));

      return new Response(stream, {
        headers: {
          "content-type": "image/png",
          "content-length": "7",
          "x-cache": "HIT from cache",
        },
      });
    },
    file.open,
    () => {},
    async (report) => {
      reports.push(report);
    },
  );
  assert.equal(count, 7);
  assert.deepEqual(file.writes, [3, 4]);
  assert.equal(file.closed, 1);
  assert.equal(reports[0].cached, true);
  assert.equal(reports[0].success, true);
});

test("rejeita resposta truncada, conteúdo HTML e tamanho declarado excessivo", async () => {
  const truncated = sink();
  await assert.rejects(
    receivePage(
      "https://node.example/image",
      new AbortController().signal,
      100,
      async () =>
        new Response(new Uint8Array(3), {
          headers: { "content-type": "image/png", "content-length": "7" },
        }),
      truncated.open,
      () => {},
    ),
    (error) => error instanceof DownloadError && error.retryable,
  );
  assert.equal(truncated.closed, 1);
  const html = sink();
  await assert.rejects(
    receivePage(
      "https://node.example/image",
      new AbortController().signal,
      100,
      async () =>
        new Response("error", { headers: { "content-type": "text/html" } }),
      html.open,
      () => {},
    ),
    /formato/,
  );
  assert.equal(html.closed, 0);
  const huge = sink();
  await assert.rejects(
    receivePage(
      "https://node.example/image",
      new AbortController().signal,
      100,
      async () =>
        new Response(new Uint8Array(3), {
          headers: { "content-type": "image/png", "content-length": "101" },
        }),
      huge.open,
      () => {},
    ),
    /tamanho/,
  );
  assert.deepEqual(huge.writes, []);
});

test("limita bytes sem Content-Length e fecha o arquivo ao cancelar", async () => {
  const file = sink();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3));
      controller.enqueue(new Uint8Array(3));
      controller.close();
    },
  });
  await assert.rejects(
    receivePage(
      "https://node.example/image",
      new AbortController().signal,
      5,
      async () =>
        new Response(stream, { headers: { "content-type": "image/png" } }),
      file.open,
      () => {},
    ),
    /limite/,
  );
  assert.deepEqual(file.writes, [3]);
  assert.equal(file.closed, 1);
  const controller = new AbortController();
  const cancelled = sink();
  await assert.rejects(
    receivePage(
      "https://node.example/image",
      controller.signal,
      100,
      async () =>
        new Response(new Uint8Array(3), {
          headers: { "content-type": "image/png" },
        }),
      cancelled.open,
      () => controller.abort(),
    ),
    { name: "AbortError" },
  );
  assert.equal(cancelled.closed, 1);
});

test("valida assinatura, término e dimensões da imagem baixada", () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  assert.deepEqual(validateDownloadedImage(png, "png"), {
    width: 1,
    height: 1,
  });
  assert.throws(() => validateDownloadedImage(png.subarray(0, -10), "png"));
  assert.throws(() => validateDownloadedImage(png, "jpg"));
});

test("HTTP 429 interrompe transferências e respeita a pausa antes de nova consulta", async () => {
  let calls = 0;
  const file = sink();
  const fetcher = async () => {
    calls++;
    return new Response("", { status: 429, headers: { "Retry-After": "30" } });
  };
  await assert.rejects(
    receivePage(
      "https://node.example/image",
      new AbortController().signal,
      100,
      fetcher,
      file.open,
      () => {},
    ),
    /limitou/,
  );
  await assert.rejects(
    receivePage(
      "https://node.example/image",
      new AbortController().signal,
      100,
      fetcher,
      file.open,
      () => {},
    ),
    /pausa/,
  );
  assert.equal(calls, 1);
});
