import test from "node:test";
import assert from "node:assert/strict";
import { reportFailureReason } from "../src/services/downloads/reports.ts";
import { receivePage } from "../src/services/downloads/transfer.ts";
import type { PageReport } from "../src/types/manga-source.ts";

const report: PageReport = { url: "https://node.example/image.png", success: true, bytes: 3, duration: 10, cached: false };

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

test("diagnóstico distingue timeout, HTTP e conexão sem expor URLs dos erros", () => {
  const errors = [
    Object.assign(new Error("https://private.example/token"), { name: "ReportTimeoutError" }),
    Object.assign(new Error("https://private.example/token"), { status: 503 }),
    Object.assign(new Error("https://private.example/token"), { name: "ReportNetworkError" }),
    new Error("https://private.example/token"),
  ];
  assert.deepEqual(errors.map(reportFailureReason), ["Tempo limite (5 s)", "HTTP 503", "Conexão/rede", "Falha não identificada"]);
});
