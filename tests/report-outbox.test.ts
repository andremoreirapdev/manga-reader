import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { migrate } from "../src/storage/database.ts";
import { createReportOutbox } from "../src/services/downloads/report-outbox.ts";
import type { MangaSource, PageReport } from "../src/types/manga-source.ts";

const report: PageReport = { url: "https://node.example/image.png", success: false, bytes: 10, duration: 30, cached: false };
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function harness(send: (report: PageReport) => Promise<void>) {
  const sqlite = new DatabaseSync(":memory:");
  let failWrite = false;
  const wrapper = {
    async execAsync(sql: string) { sqlite.exec(sql); },
    async getFirstAsync(sql: string, ...params: (string | number)[]) {
      return sqlite.prepare(sql).get(...params) ?? null;
    },
    async getAllAsync(sql: string, ...params: (string | number)[]) {
      return sqlite.prepare(sql).all(...params);
    },
    async runAsync(sql: string, ...params: (string | number | null)[]) {
      if (failWrite) throw new Error("Disco indisponível");

      return sqlite.prepare(sql).run(...params);
    },
    async withTransactionAsync(work: () => Promise<void>) {
      sqlite.exec("BEGIN");

      try {
        await work();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const db = wrapper as unknown as SQLiteDatabase;
  await migrate(db);
  let clock = 1000;
  const tasks: { at: number; canceled: boolean; callback: () => void }[] = [];
  const queues: ReturnType<typeof createReportOutbox>[] = [];

  function create() {
    const queue = createReportOutbox(db, { id: "mangadex", reportPage: send } as MangaSource, () => {}, {
      now: () => clock,
      schedule(callback, milliseconds) {
        const task = { at: clock + milliseconds, canceled: false, callback };
        tasks.push(task);

        return () => { task.canceled = true; };
      },
    });
    queues.push(queue);

    return queue;
  }

  return {
    sqlite, db, create,
    failWrites(value: boolean) { failWrite = value; },
    advance(milliseconds: number) { clock += milliseconds; },
    async runDue() {
      const task = tasks.find((task) => !task.canceled && task.at <= clock);

      if (!task) return false;

      task.canceled = true;
      task.callback();
      await settle();

      return true;
    },
    close() {
      queues.forEach((queue) => queue.pause());
      sqlite.close();
    },
  };
}

test("registrar pendentes não aguarda rede e só um relatório é enviado por vez", async () => {
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const h = await harness(async () => { calls++; await release.promise; });

  try {
    const queue = h.create();
    await queue.resume();
    await queue.enqueue("chapter", report);
    await h.runDue();
    assert.equal(calls, 1);
    assert.equal(queue.getSnapshot().active, true);
    await queue.enqueue("chapter", report);
    await queue.enqueue("chapter", report);
    assert.equal(calls, 1);
    assert.equal(queue.getSnapshot().pending, 3);
    queue.pause();
    release.resolve();
    await settle();
    assert.equal(queue.getSnapshot().sent, 1);
    assert.equal(queue.getSnapshot().pending, 2);
    assert.equal(await h.runDue(), false);
  } finally {
    release.resolve();
    await settle();
    h.close();
  }
});

test("novo processador recupera pendentes do SQLite e remove apenas envios bem-sucedidos", async () => {
  let calls = 0;
  const h = await harness(async () => { calls++; });

  try {
    const before = h.create();
    await before.enqueue("chapter", report);
    before.pause();
    const after = h.create();
    await after.resume();
    assert.equal(after.getSnapshot().pending, 1);
    await h.runDue();
    assert.equal(calls, 1);
    assert.equal(after.getSnapshot().pending, 0);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM page_reports").get()?.count, 0);
  } finally {
    h.close();
  }
});

test("limita a três tentativas persistidas com esperas de 30 e 120 segundos", async () => {
  let calls = 0;
  const h = await harness(async () => {
    calls++;
    throw Object.assign(new Error("timeout"), { name: "ReportTimeoutError" });
  });

  try {
    const queue = h.create();
    await queue.enqueue("chapter", report);
    await queue.resume();
    await h.runDue();
    assert.equal(calls, 1);
    assert.equal(await h.runDue(), false);
    h.advance(30000);
    await h.runDue();
    assert.equal(calls, 2);
    h.advance(120000);
    await h.runDue();
    assert.equal(calls, 3);
    assert.equal(queue.getSnapshot().failed, 1);
    assert.equal(queue.getSnapshot().pending, 0);
    assert.equal(h.sqlite.prepare("SELECT attempts FROM page_reports").get()?.attempts, 3);
    queue.pause();
    const restarted = h.create();
    await restarted.resume();
    await h.runDue();
    assert.equal(calls, 3);
    assert.equal(restarted.getSnapshot().failed, 1);
  } finally {
    h.close();
  }
});

test("pausa HTTP 429 sobrevive à recriação e vale também para novos relatórios", async () => {
  let calls = 0;
  const h = await harness(async () => {
    calls++;

    if (calls === 1) throw { status: 429, retryAt: 91000 };
  });

  try {
    const queue = h.create();
    await queue.enqueue("chapter", report);
    await queue.resume();
    await h.runDue();
    queue.pause();
    const restarted = h.create();
    await restarted.resume();
    await restarted.enqueue("another-chapter", report);
    await h.runDue();
    assert.equal(calls, 1);
    h.advance(89999);
    assert.equal(await h.runDue(), false);
    h.advance(1);
    await h.runDue();
    assert.equal(calls, 2);
  } finally {
    h.close();
  }
});

test("falha de persistência é explícita e não cria registros em memória perdidos", async () => {
  const h = await harness(async () => {});

  try {
    const queue = h.create();
    h.failWrites(true);
    await assert.rejects(queue.enqueue("chapter", report), /Disco indisponível/);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM page_reports").get()?.count, 0);
  } finally {
    h.close();
  }
});

test("um relatório com falha não segura relatórios novos até o horário da repetição", async () => {
  let calls = 0;
  const h = await harness(async () => {
    calls++;

    if (calls === 1) throw Object.assign(new Error("indisponível"), { status: 503 });
  });

  try {
    const queue = h.create();
    await queue.resume();
    await queue.enqueue("first", report);
    await h.runDue();
    await queue.enqueue("second", report);
    await h.runDue();
    assert.equal(calls, 2);
    assert.equal(queue.getSnapshot().pending, 1);
    assert.equal(queue.getSnapshot().sent, 1);
    assert.equal(h.sqlite.prepare("SELECT chapterId FROM page_reports").get()?.chapterId, "first");
  } finally {
    h.close();
  }
});

test("migração recupera fila da versão 3 sem tabela de pausas, preservando 98 pendentes", async (context) => {
  context.mock.method(console, "warn", () => {});
  let calls = 0;
  const h = await harness(async () => { calls++; });

  try {
    const queue = h.create();

    for (let index = 0; index < 98; index++) {
      await queue.enqueue("chapter", report);
    }

    h.sqlite.exec("DROP TABLE page_report_limits; PRAGMA user_version=3;");
    await queue.resume();
    await h.runDue();
    assert.equal(calls, 0);
    assert.equal(queue.getSnapshot().pending, 98);
    assert.equal(queue.getSnapshot().nextAttemptAt, 31000);
    assert.match(queue.getSnapshot().lastError ?? "", /consultar pausa da fonte.*no such table.*page_report_limits/);
    queue.pause();
    await migrate(h.db);
    assert.equal(h.sqlite.prepare("PRAGMA user_version").get()?.user_version, 4);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM page_reports").get()?.count, 98);
    const recovered = h.create();
    await recovered.resume();
    await h.runDue();
    assert.equal(calls, 1);
    assert.equal(recovered.getSnapshot().pending, 97);
    assert.equal(recovered.getSnapshot().lastError, null);
  } finally {
    h.close();
  }
});

test("ignora sucessos novos e limpa sucessos antigos em lotes, inclusive os esgotados", async () => {
  const sent: PageReport[] = [];
  const h = await harness(async (report) => { sent.push(report); });

  try {
    const queue = h.create();
    await queue.enqueue("new-success", { ...report, success: true });
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM page_reports").get()?.count, 0);
    const insert = h.sqlite.prepare("INSERT INTO page_reports(source,chapterId,payload,attempts,nextAttemptAt) VALUES (?,?,?,?,0)");

    for (let index = 0; index < 205; index++) {
      insert.run("mangadex", "old-success", JSON.stringify({ ...report, success: true }), index % 4);
    }

    insert.run("another-source", "unrelated", JSON.stringify({ ...report, success: true }), 0);
    await queue.enqueue("real-failure", report);
    await queue.resume();
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM page_reports WHERE source='mangadex'").get()?.count, 1);
    assert.equal(queue.getSnapshot().failed, 0);
    await h.runDue();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].success, false);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS count FROM page_reports WHERE source='another-source'").get()?.count, 1);
  } finally {
    h.close();
  }
});
