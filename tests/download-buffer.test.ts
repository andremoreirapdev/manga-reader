import test from "node:test";
import assert from "node:assert/strict";
import { receivePage, type PageFetcher } from "../src/services/downloads/transfer.ts";
import { DownloadError } from "../src/features/downloads/engine.ts";
import type { PageReport } from "../src/types/manga-source.ts";

const url = "https://node.example/page.png";

function nativeResponse(data = new Uint8Array([1, 2, 3]), length = 3) {
  return {
    url,
    status: 200,
    ok: true,
    headers: new Headers({ "content-type": "image/png", "content-length": String(length) }),
    get body(): Response["body"] {
      throw new Error("O caminho nativo não deve inicializar o stream JS");
    },
    async arrayBuffer() { return Uint8Array.from(data).buffer; },
  };
}

function destination() {
  const writes: Uint8Array[] = [];
  let closed = 0;

  return {
    writes,
    get closed() { return closed; },
    open: () => ({
      async write(data: Uint8Array) { writes.push(data); },
      close() { closed++; },
    }),
  };
}

test("imagem pequena com tamanho conhecido usa buffer nativo sem acessar stream JS", async () => {
  const file = destination();
  const reports: PageReport[] = [];
  const stages: string[] = [];
  const count = await receivePage(url, new AbortController().signal, 100,
    async () => nativeResponse(), file.open, () => {},
    async (report) => { reports.push(report); },
    (stage) => stages.push(stage), "prefer-native-buffer",
  );
  assert.equal(count, 3);
  assert.deepEqual(Array.from(file.writes[0]), [1, 2, 3]);
  assert.equal(file.closed, 1);
  assert.ok(stages.includes("nativeBufferPages"));
  assert.ok(!stages.includes("streamPages"));
  assert.equal(reports[0].success, true);
  assert.equal(reports[0].bytes, 3);
});

test("sem tamanho confiável ou acima de 4 MiB permanece em streaming", async () => {
  const cases: { data: Uint8Array<ArrayBuffer>; headers: Record<string, string> }[] = [
    { data: new Uint8Array(3), headers: { "content-type": "image/png" } },
    { data: new Uint8Array(3), headers: { "content-type": "image/png", "content-length": "3", "content-encoding": "gzip" } },
    { data: new Uint8Array(4 * 1024 ** 2 + 1), headers: { "content-type": "image/png", "content-length": String(4 * 1024 ** 2 + 1) } },
  ];

  for (const item of cases) {
    const file = destination();
    const response = new Response(item.data, { headers: item.headers });
    response.arrayBuffer = async () => { throw new Error("Não deveria usar buffer"); };
    const stages: string[] = [];
    const count = await receivePage(url, new AbortController().signal, 24 * 1024 ** 2,
      async () => response, file.open, () => {}, undefined,
      (stage) => stages.push(stage), "prefer-native-buffer",
    );
    assert.equal(count, item.data.length);
    assert.ok(stages.includes("streamPages"));
    assert.ok(!stages.includes("nativeBufferPages"));
  }
});

test("buffer truncado ou acima do limite não é gravado", async () => {
  for (const size of [2, 4]) {
    const file = destination();
    await assert.rejects(receivePage(url, new AbortController().signal, 3,
      async () => nativeResponse(new Uint8Array(size)), file.open, () => {}, undefined,
      () => {}, "prefer-native-buffer",
    ), (error) => error instanceof DownloadError && error.retryable === (size === 2));
    assert.equal(file.writes.length, 0);
    assert.equal(file.closed, 1);
  }
});

test("cancelamento libera espera JS mesmo se arrayBuffer nativo ficar pendente", async () => {
  const controller = new AbortController();
  const file = destination();
  const fetcher: PageFetcher = async () => {
    const response = nativeResponse();
    response.arrayBuffer = () => {
      controller.abort();
      return new Promise<ArrayBuffer>(() => {});
    };

    return response;
  };
  await assert.rejects(receivePage(url, controller.signal, 100,
    fetcher, file.open, () => {}, undefined, () => {}, "prefer-native-buffer",
  ), { name: "AbortError" });
  assert.equal(file.closed, 1);
});

test("timeout nativo segue limite de 90 segundos e permite repetição controlada", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const reading = Promise.withResolvers<void>();
  const file = destination();
  const operation = receivePage(url, new AbortController().signal, 100,
    async () => {
      const response = nativeResponse();
      response.arrayBuffer = () => {
        reading.resolve();
        return new Promise<ArrayBuffer>(() => {});
      };

      return response;
    }, file.open, () => {}, undefined, () => {}, "prefer-native-buffer",
  );
  const rejected = assert.rejects(operation,
    (error) => error instanceof DownloadError && error.retryable && /demorou/.test(error.message),
  );
  await reading.promise;
  context.mock.timers.tick(90000);
  await rejected;
  assert.equal(file.closed, 1);
});
