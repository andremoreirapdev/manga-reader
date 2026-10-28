import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { migrate } from "../src/storage/database.ts";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const wrapper = {
    async execAsync(sql: string) {
      sqlite.exec(sql);
    },
    async getFirstAsync(sql: string) {
      return sqlite.prepare(sql).get();
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

  return { sqlite, wrapper, db: wrapper as unknown as SQLiteDatabase };
}

test("novo banco recebe esquema de downloads e índice de capítulo único", async () => {
  const { sqlite, db } = database();

  try {
    await migrate(db);
    assert.equal(sqlite.prepare("PRAGMA user_version").get()?.user_version, 4);
    sqlite.exec(
      "INSERT INTO books(id,title,pages,accessed,cover,source,sourceChapterId) VALUES ('1','A',1,0,'cover','mangadex','chapter')",
    );
    assert.throws(() =>
      sqlite.exec(
        "INSERT INTO books(id,title,pages,accessed,cover,source,sourceChapterId) VALUES ('2','B',1,0,'cover','mangadex','chapter')",
      ),
    );
  } finally {
    sqlite.close();
  }
});

test("migração do banco existente preserva biblioteca, página e modo", async () => {
  const { sqlite, db } = database();

  try {
    sqlite.exec(
      "CREATE TABLE books (id TEXT PRIMARY KEY,title TEXT NOT NULL,pages INTEGER NOT NULL,page INTEGER NOT NULL DEFAULT 0,mode TEXT NOT NULL DEFAULT 'paged',accessed INTEGER NOT NULL,cover TEXT NOT NULL); INSERT INTO books VALUES ('old','Meu CBZ',100,37,'vertical',42,'cover'); PRAGMA user_version=1;",
    );
    await migrate(db);
    await migrate(db);
    const book = sqlite.prepare("SELECT * FROM books").get();
    assert.equal(book?.page, 37);
    assert.equal(book?.mode, "vertical");
    assert.equal(book?.source, "cbz");
    assert.equal(book?.sourceChapterId, null);
    assert.equal(book?.credits, null);
  } finally {
    sqlite.close();
  }
});

test("falha na migração desfaz alterações e não muda a versão", async () => {
  const { sqlite, db, wrapper } = database();

  try {
    sqlite.exec(
      "CREATE TABLE books (id TEXT PRIMARY KEY,title TEXT NOT NULL,pages INTEGER NOT NULL,page INTEGER NOT NULL DEFAULT 0,mode TEXT NOT NULL DEFAULT 'paged',accessed INTEGER NOT NULL,cover TEXT NOT NULL); PRAGMA user_version=1;",
    );
    const original = wrapper.execAsync;
    wrapper.execAsync = async (sql) => {
      if (sql.includes("CREATE TABLE downloads")) {
        sqlite.exec("ALTER TABLE books ADD COLUMN temporaryTest TEXT");
        throw new Error("Falha simulada");
      }

      await original(sql);
    };
    await assert.rejects(migrate(db), /Falha simulada/);
    assert.equal(sqlite.prepare("PRAGMA user_version").get()?.user_version, 1);
    assert.ok(
      !sqlite
        .prepare("PRAGMA table_info(books)")
        .all()
        .some((row) => row.name === "temporaryTest"),
    );
  } finally {
    sqlite.close();
  }
});

test("migra versão 2 preservando capítulos e downloads existentes", async () => {
  const { sqlite, db } = database();

  try {
    await migrate(db);
    sqlite.exec(`DROP TABLE page_reports; DROP TABLE page_report_limits; PRAGMA user_version=2;
      INSERT INTO books(id,title,pages,page,accessed,cover,source,sourceChapterId) VALUES ('old','Capítulo salvo',48,12,42,'cover','mangadex','chapter');
      INSERT INTO downloads(chapterId,request,status,bookId,updatedAt) VALUES ('chapter','{}','completed','old',42);`);
    await migrate(db);
    assert.equal(sqlite.prepare("PRAGMA user_version").get()?.user_version, 4);
    assert.equal(sqlite.prepare("SELECT page FROM books").get()?.page, 12);
    assert.equal(sqlite.prepare("SELECT status FROM downloads").get()?.status, "completed");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM page_reports").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("migração da versão 3 conserva limites da fonte e tentativas já registradas", async () => {
  const { sqlite, db } = database();

  try {
    await migrate(db);
    sqlite.exec(`PRAGMA user_version=3;
      INSERT INTO page_report_limits(source,retryAt) VALUES ('mangadex',999999);
      INSERT INTO page_reports(source,chapterId,payload,attempts,nextAttemptAt,lastError) VALUES ('mangadex','chapter','{}',2,888888,'HTTP 429');`);
    await migrate(db);
    await migrate(db);
    assert.equal(sqlite.prepare("PRAGMA user_version").get()?.user_version, 4);
    assert.equal(sqlite.prepare("SELECT retryAt FROM page_report_limits").get()?.retryAt, 999999);
    assert.equal(sqlite.prepare("SELECT attempts FROM page_reports").get()?.attempts, 2);
    assert.equal(sqlite.prepare("SELECT nextAttemptAt FROM page_reports").get()?.nextAttemptAt, 888888);
  } finally {
    sqlite.close();
  }
});
