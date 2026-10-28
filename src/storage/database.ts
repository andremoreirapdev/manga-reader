import { type SQLiteDatabase } from "expo-sqlite";

export type Book = {
  id: string;
  title: string;
  pages: number;
  page: number;
  mode: "paged" | "vertical";
  accessed: number;
  cover: string;
};

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  const version = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );

  if ((version?.user_version ?? 0) > 1)
    throw new Error("Banco criado por uma versão mais recente.");

  if (!version?.user_version)
    await db.withTransactionAsync(async () => {
      await db.execAsync(
        `CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, pages INTEGER NOT NULL, page INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'paged', accessed INTEGER NOT NULL, cover TEXT NOT NULL); PRAGMA user_version = 1;`,
      );
    });
}

export const listBooks = (db: SQLiteDatabase) =>
  db.getAllAsync<Book>("SELECT * FROM books ORDER BY accessed DESC");
