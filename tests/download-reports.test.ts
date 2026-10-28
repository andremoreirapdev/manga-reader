import test from "node:test";
import assert from "node:assert/strict";
import { createReportQueue } from "../src/services/downloads/reports.ts";
import { receivePage } from "../src/services/downloads/transfer.ts";
import type { PageReport } from "../src/types/manga-source.ts";

const report: PageReport = {
  url: "https://node.example/image.png",
  success: true,
  bytes: 3,
  duration: 10,
  cached: false,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("duas páginas terminam de gravar enquanto relatórios anteriores ainda aguardam resposta", async () => {
  const release = Promise.withResolvers<void>();
  let sent = 0;
  let written = 0;
  const queue = createReportQueue(async () => {
    sent++;
    await release.promise;
  }, () => {});
  const stages: string[] = [];

  try {
    for (let index = 0; index < 2; index++) {
      await receivePage(report.url, new AbortController().signal, 100,
        async () => new Response(new Uint8Array(3), { headers: { "content-type": "image/png" } }),
        () => ({ async write() { written++; }, close() {} }),
        () => {}, queue.enqueue,
        (stage, duration) => {
          assert.ok(duration >= 0);
          stages.push(stage);
        },
      );
    }

    assert.equal(written, 2);
    assert.equal(sent, 2);
    assert.ok(stages.includes("headersMs"));
    assert.ok(stages.includes("readMs"));
    assert.ok(stages.includes("writeMs"));
    assert.ok(stages.includes("cleanupMs"));
    let drained = false;
    const draining = queue.drain().then(() => { drained = true; });
    await tick();
    assert.equal(drained, false);
    release.resolve();
    await draining;
  } finally {
    release.resolve();
    await queue.drain();
  }
});

test("fila limita envios ativos e pendentes e não descarta relatórios", async () => {
  const release = Promise.withResolvers<void>();
  let active = 0;
  let peak = 0;
  let sent = 0;
  const queue = createReportQueue(async () => {
    active++;
    peak = Math.max(peak, active);
    sent++;
    await release.promise;
    active--;
  }, () => {});

  try {
    for (let index = 0; index < 4; index++) {
      await queue.enqueue(report);
    }

    let accepted = false;
    const fifth = queue.enqueue(report).then(() => { accepted = true; });
    await tick();
    assert.equal(sent, 2);
    assert.equal(accepted, false);
    release.resolve();
    await fifth;
    await queue.drain();
    assert.equal(sent, 5);
    assert.equal(peak, 2);
  } finally {
    release.resolve();
    await queue.drain();
  }
});

test("falha no relatório é contabilizada sem bloquear os próximos envios", async () => {
  let failed = 0;
  let sent = 0;
  const queue = createReportQueue(async () => {
    sent++;

    if (sent === 1) throw new Error("Servidor de relatórios indisponível");
  }, (_stage, _duration, error) => {
    if (error) failed++;
  });

  for (let index = 0; index < 5; index++) {
    await queue.enqueue(report);
  }

  await queue.drain();
  assert.equal(sent, 5);
  assert.equal(failed, 1);
});

test("tentativa cancelada também relata os bytes já recebidos e libera o arquivo", async () => {
  const controller = new AbortController();
  const reports: PageReport[] = [];
  let closed = false;
  await assert.rejects(receivePage(report.url, controller.signal, 100,
    async () => new Response(new Uint8Array(3), { headers: { "content-type": "image/png" } }),
    () => ({ async write() {}, close() { closed = true; } }),
    () => controller.abort(),
    async (value) => { reports.push(value); },
  ), { name: "AbortError" });
  assert.equal(closed, true);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].success, false);
  assert.equal(reports[0].bytes, 3);
});

test("diagnóstico distingue timeout, HTTP e conexão sem expor URLs dos erros", async () => {
  const errors = [
    Object.assign(new Error("https://private.example/token"), { name: "ReportTimeoutError" }),
    Object.assign(new Error("https://private.example/token"), { status: 503 }),
    Object.assign(new Error("https://private.example/token"), { name: "ReportNetworkError" }),
    new Error("https://private.example/token"),
  ];
  const reasons: string[] = [];
  const queue = createReportQueue(async () => {
    throw errors.shift();
  }, (_stage, _duration, failed, reason) => {
    if (failed && reason) reasons.push(reason);
  });

  for (let index = 0; index < 4; index++) {
    await queue.enqueue(report);
  }

  await queue.drain();
  assert.deepEqual(reasons.sort(), ["Conexão/rede", "Falha não identificada", "HTTP 503", "Tempo limite (5 s)"].sort());
});
