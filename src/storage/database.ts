import { type SQLiteDatabase } from "expo-sqlite";

export type Book = {
  id: string;
  title: string;
  pages: number;
  page: number;
  mode: "paged" | "vertical";
  accessed: number;
  cover: string;
  source?: string;
  sourceChapterId?: string | null;
  credits?: string | null;
};

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  const version = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );

  const current = version?.user_version ?? 0;

  if (current > 2) throw new Error("Banco criado por uma versão mais recente.");

  if (current < 2)
    await db.withTransactionAsync(async () => {
      if (current === 0) {
        await db.execAsync(
          `CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, pages INTEGER NOT NULL, page INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'paged', accessed INTEGER NOT NULL, cover TEXT NOT NULL);`,
        );
      }

      await db.execAsync(`
        ALTER TABLE books ADD COLUMN source TEXT NOT NULL DEFAULT 'cbz';
        ALTER TABLE books ADD COLUMN sourceChapterId TEXT;
        ALTER TABLE books ADD COLUMN credits TEXT;
        CREATE UNIQUE INDEX books_source_chapter ON books(source, sourceChapterId);
        CREATE TABLE downloads (
          chapterId TEXT PRIMARY KEY,
          request TEXT NOT NULL,
          status TEXT NOT NULL,
          bookId TEXT NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          updatedAt INTEGER NOT NULL
        );
        PRAGMA user_version = 2;
      `);
    });
}

export const listBooks = (db: SQLiteDatabase) =>
  db.getAllAsync<Book>("SELECT * FROM books ORDER BY accessed DESC");
