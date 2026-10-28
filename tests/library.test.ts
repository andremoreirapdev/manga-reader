import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Executa o serviço real com fronteiras nativas simuladas; não carrega Expo no Node.
function setup(copyFailure = false, downloaded = false) {
  const events: string[] = [];
  const deleted: string[] = [];
  let copied = false;

  class Directory {
    uri = "file:///private/library";
    exists = true;
    create() {}
    delete() {
      events.push("delete-private");
    }
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === "string" ? part : part.uri))
        .join("/");
    }
  }

  class File {
    uri: string;
    get exists() {
      return downloaded || !this.uri.endsWith("/pages.json");
    }
    size = 100;
    constructor(parent: string | Directory, name?: string) {
      this.uri = typeof parent === "string" ? parent : `${parent.uri}/${name}`;
    }

    async copy() {
      events.push("copy-start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (copyFailure) throw new Error("Missing READ permission");
      copied = true;
      events.push("copy-finish");
    }

    open() {
      assert.ok(copied, "o arquivo só pode ser aberto após a cópia");
      return {
        close() {},
        offset: 0,
        readBytesSync() {
          return new Uint8Array();
        },
      };
    }

    async write() {
      events.push("write");
    }

    async text() {
      return JSON.stringify(
        this.uri.endsWith("/pages.json")
          ? ["page-00001.png"]
          : [{ name: "1.png" }],
      );
    }

    delete() {
      events.push("delete-original");
      deleted.push(this.uri);
    }
  }

  const modules: Record<string, unknown> = {
    "expo-file-system": {
      Directory,
      File,
      Paths: { document: "file:///private", cache: "file:///cache" },
    },
    "expo-document-picker": {
      async getDocumentAsync(options: { copyToCacheDirectory: boolean }) {
        assert.equal(options.copyToCacheDirectory, false);
        return {
          canceled: false,
          assets: [
            { uri: "content://downloads/42", name: "teste.cbz", size: 100 },
          ],
        };
      },
    },
    "expo-crypto": { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    "../features/reader/layout": {
      imageSize: () => ({ width: 800, height: 1200 }),
    },
    "./zip": {
      indexZip: () => [{ name: "1.png" }],
      extractPage: () => new Uint8Array([1]),
    },
  };

  const module = {
    exports: {} as {
      importBook: (db: unknown) => Promise<boolean>;
      createVerticalSession: typeof import("../src/services/library").createVerticalSession;
    },
  };

  const source = readFileSync("src/services/library.ts", "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Módulo inesperado: ${name}`);
      return modules[name];
    },
    setTimeout,
  });

  return {
    events,
    deleted,
    importBook: module.exports.importBook,
    createSession: module.exports.createVerticalSession,
  };
}

test("importa da URI autorizada, aguarda a cópia e preserva o original", async () => {
  const { events, importBook } = setup();
  assert.equal(
    await importBook({
      async runAsync() {
        events.push("insert");
      },
    }),
    true,
  );
  assert.deepEqual(events, [
    "copy-start",
    "copy-finish",
    "write",
    "write",
    "insert",
  ]);
});

test("falha de cópia é propagada e só remove a pasta privada incompleta", async () => {
  const { events, importBook } = setup(true);
  await assert.rejects(importBook({}), /Missing READ permission/);
  assert.deepEqual(events, ["copy-start", "delete-private"]);
});

test("cache vertical mantém página em uso e libera somente após a última referência", async () => {
  const { deleted, createSession } = setup();
  const session = createSession("11111111-1111-4111-8111-111111111111");
  const first = session.retain(0),
    second = session.retain(0);
  const [uri] = await Promise.all([first.uri, second.uri]);
  first.release();
  first.release();
  assert.equal(deleted.length, 0);
  second.release();
  assert.deepEqual(deleted, [uri]);
  session.close();
});

test("cache vertical cancela extração de célula liberada antes de chegar à fila", async () => {
  const { deleted, createSession } = setup();
  const session = createSession("11111111-1111-4111-8111-111111111111");
  const cell = session.retain(0);
  cell.release();
  await assert.rejects(cell.uri, /Página liberada/);
  assert.equal(deleted.length, 0);
  session.close();
});

test("cache vertical nunca apaga páginas permanentes de um capítulo baixado", async () => {
  const { deleted, createSession } = setup(false, true);
  const session = createSession("11111111-1111-4111-8111-111111111111");
  const page = session.retain(0);
  const uri = await page.uri;
  assert.match(uri, /private\/library\/.*\/page-00001.png$/);
  page.release();
  session.close();
  assert.deepEqual(deleted, []);
});
