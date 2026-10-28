import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SQLiteDatabase } from "expo-sqlite";
import { migrate } from "../../src/storage/database.ts";
import {
  runChapterDownload,
  DownloadError,
} from "../../src/features/downloads/engine.ts";
import { validateDownloadedImage } from "../../src/features/downloads/validation.ts";
import { receivePage } from "../../src/services/downloads/transfer.ts";
import { createReportOutbox } from "../../src/services/downloads/report-outbox.ts";
import type { createDownloadManager } from "../../src/services/downloads/manager.ts";
import type { PageFetcher } from "../../src/services/downloads/transfer.ts";

export const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
    "base64",
  ),
);

export async function nativeDownloadHarness(
  fetcher: PageFetcher = async () =>
    new Response(png, {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.length),
      },
    }),
  reportSchedule: (callback: () => void, milliseconds: number) => () => void = () => () => {},
) {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(["file:///private"]);
  const uriOf = (...parts: (string | { uri: string })[]) =>
    parts
      .map((part) =>
        (typeof part === "string" ? part : part.uri).replace(/\/$/, ""),
      )
      .join("/");

  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uriOf(...parts);
    }

    get exists() {
      return directories.has(this.uri);
    }

    create(options?: { idempotent?: boolean; intermediates?: boolean }) {
      if (this.exists && !options?.idempotent)
        throw new Error("Diretório já existe");

      directories.add(this.uri);
    }

    delete() {
      for (const key of files.keys())
        if (key.startsWith(this.uri + "/")) files.delete(key);
      for (const key of directories)
        if (key === this.uri || key.startsWith(this.uri + "/"))
          directories.delete(key);
    }

    async move(destination: Directory) {
      if (destination.exists) throw new Error("Destino já existe");

      for (const [name, bytes] of [...files]) {
        if (name.startsWith(this.uri + "/")) {
          files.set(destination.uri + name.slice(this.uri.length), bytes);
          files.delete(name);
        }
      }

      directories.delete(this.uri);
      directories.add(destination.uri);
      this.uri = destination.uri;
    }
  }

  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = uriOf(...parts);
    }

    get exists() {
      return files.has(this.uri);
    }

    get size() {
      return files.get(this.uri)?.length ?? 0;
    }

    create() {
      if (!directories.has(this.uri.slice(0, this.uri.lastIndexOf("/"))))
        throw new Error("Pasta ausente");

      files.set(this.uri, new Uint8Array());
    }

    async write(value: string | Uint8Array) {
      files.set(
        this.uri,
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value.slice(),
      );
    }

    async bytes() {
      return files.get(this.uri)!.slice();
    }

    async text() {
      return new TextDecoder().decode(files.get(this.uri));
    }

    delete() {
      files.delete(this.uri);
    }

    async move(destination: File) {
      files.set(destination.uri, files.get(this.uri)!);
      files.delete(this.uri);
      this.uri = destination.uri;
    }

    open() {
      let closed = false;
      const file = this;

      return {
        offset: 0,
        async writeBytes(value: Uint8Array) {
          if (closed) throw new Error("Arquivo fechado");

          const current = files.get(file.uri)!;
          const next = new Uint8Array(current.length + value.length);
          next.set(current);
          next.set(value, current.length);
          files.set(file.uri, next);
        },
        close() {
          closed = true;
        },
      };
    }
  }

  const sqlite = new DatabaseSync(":memory:");
  let failPublish = false;
  const transaction = async (work: (tx: unknown) => Promise<void>) => {
    sqlite.exec("BEGIN");

    try {
      await work(wrapper);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };

  const wrapper = {
    async execAsync(sql: string) {
      sqlite.exec(sql);
    },
    async getFirstAsync(sql: string, ...params: (string | number)[]) {
      return sqlite.prepare(sql).get(...params) ?? null;
    },
    async getAllAsync(sql: string, ...params: (string | number)[]) {
      return sqlite.prepare(sql).all(...params);
    },
    async runAsync(sql: string, ...params: (string | number | null)[]) {
      if (failPublish && sql.includes("SET status = 'completed'"))
        throw new Error("Falha na publicação SQLite");

      return sqlite.prepare(sql).run(...params);
    },
    withTransactionAsync: (work: () => Promise<void>) => transaction(work),
    withExclusiveTransactionAsync: transaction,
  };

  const db = wrapper as unknown as SQLiteDatabase;
  await migrate(db);
  let counter = 0;
  const modules: Record<string, unknown> = {
    "expo-file-system": {
      Directory,
      File,
      FileMode: { WriteOnly: "w" },
      Paths: { document: "file:///private" },
    },
    "expo/fetch": { fetch: fetcher },
    "expo-crypto": {
      randomUUID: () =>
        `11111111-1111-4111-8111-${String(++counter).padStart(12, "0")}`,
    },
    "../../features/downloads/engine": {
      DownloadError,
      runChapterDownload: (...args: Parameters<typeof runChapterDownload>) =>
        runChapterDownload(
          args[0],
          args[1],
          args[2],
          args[3],
          args[4],
          async () => {},
          args[6],
          args[7],
        ),
    },
    "../../features/downloads/validation": { validateDownloadedImage },
    "./transfer": { receivePage },
    "./report-outbox": {
      createReportOutbox: (...args: Parameters<typeof createReportOutbox>) =>
        createReportOutbox(args[0], args[1], args[2], { schedule: reportSchedule }),
    },
  };

  const module = {
    exports: {} as { createDownloadManager: typeof createDownloadManager },
  };

  const { outputText } = ts.transpileModule(
    readFileSync("src/services/downloads/manager.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  );
  
  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Import inesperado ${name}`);

      return modules[name];
    },
    AbortController,
    Date,
    Map,
    Set,
    console,
  });

  return {
    createManager: module.exports.createDownloadManager,
    db,
    sqlite,
    files,
    directories,
    setFailPublish(value: boolean) {
      failPublish = value;
    },
  };
}
