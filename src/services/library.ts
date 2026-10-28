import { Directory, File, Paths } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import { extractPage, indexZip, type Read, type Entry } from "./zip";
import { imageSize, type PageSize } from "../features/reader/layout";

const root = () => {
  const d = new Directory(Paths.document, "library");
  d.create({ idempotent: true, intermediates: true });
  return d;
};

async function downloadedPages(dir: Directory): Promise<string[] | null> {
  const metadata = new File(dir, "pages.json");

  if (!metadata.exists) return null;

  const pages: unknown = JSON.parse(await metadata.text());

  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    !pages.every(
      (page) =>
        typeof page === "string" && /^page-\d{5}\.(jpe?g|png|webp)$/.test(page),
    )
  ) {
    throw new Error("Índice do capítulo baixado inválido.");
  }

  return pages;
}

function open(file: File) {
  const handle = file.open();

  const read: Read = (offset, size) => {
    if (offset < 0 || size < 0 || offset + size > file.size)
      throw new Error("Arquivo truncado.");

    handle.offset = offset;
    const b = handle.readBytesSync(size);
    if (b.length !== size) throw new Error("Leitura incompleta.");

    return b;
  };

  return { read, close: () => handle.close() };
}

export async function importBook(db: SQLiteDatabase): Promise<boolean> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    // Mantém a URI content:// autorizada pelo seletor Android. No Expo Go,
    // o cache do DocumentPicker pode ficar fora da pasta privada do projeto.
    // A cópia para nossa biblioteca é feita explicitamente abaixo.
    copyToCacheDirectory: false,
    multiple: false,
  });

  if (result.canceled) return false;

  const asset = result.assets[0],
    source = new File(asset.uri);
  let dir: Directory | undefined;

  try {
    if (!/\.cbz$/i.test(asset.name))
      throw new Error("Selecione um arquivo .cbz.");

    if ((asset.size ?? source.size) > 2 * 1024 ** 3)
      throw new Error("O limite do CBZ é 2 GiB.");

    const id = Crypto.randomUUID();
    dir = new Directory(root(), id);
    dir.create();
    const archive = new File(dir, "archive.cbz");
    // Copia do documento autorizado pelo usuário para a área privada do app.
    // Não lê o CBZ inteiro em memória e não modifica o documento original.
    await source.copy(archive);

    if (archive.size > 2 * 1024 ** 3)
      throw new Error("O limite do CBZ é 2 GiB.");

    const reader = open(archive);
    let entries: Entry[];

    try {
      entries = indexZip(reader.read, archive.size);
      // Valida sequencialmente, liberando cada página antes da próxima.
      for (let i = 0; i < entries.length; i++) {
        const bytes = extractPage(reader.read, entries[i]);
        if (i === 0)
          await new File(
            dir,
            "cover." + entries[0].name.split(".").pop()!.toLowerCase(),
          ).write(bytes);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      reader.close();
    }

    await new File(dir, "index.json").write(JSON.stringify(entries));
    const cover = new File(
      dir,
      "cover." + entries[0].name.split(".").pop()!.toLowerCase(),
    ).uri;

    await db.runAsync(
      "INSERT INTO books (id,title,pages,accessed,cover) VALUES (?,?,?,?,?)",
      id,
      asset.name.replace(/\.cbz$/i, ""),
      entries.length,
      Date.now(),
      cover,
    );
    dir = undefined;

    return true;
  } finally {
    if (dir?.exists) dir.delete();
    // A origem pertence ao usuário (Downloads/Drive etc.), não ao aplicativo.
  }
}

export async function pageUri(
  id: string,
  page: number,
  session?: string,
): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Identificador inválido.");

  const dir = new Directory(root(), id);
  const downloaded = await downloadedPages(dir);

  if (downloaded) {
    const name = downloaded[page];

    if (!name) throw new Error("Página inexistente.");

    const stored = new File(dir, name);

    if (!stored.exists)
      throw new Error("Página ausente. Remova o capítulo e baixe novamente.");

    return stored.uri;
  }

  const entries = JSON.parse(
    await new File(dir, "index.json").text(),
  ) as Entry[];

  const entry = entries[page];
  if (!entry) throw new Error("Página inexistente.");
  if (session && !/^[0-9a-f-]{36}$/i.test(session))
    throw new Error("Sessão inválida.");

  const cache = session
    ? new Directory(Paths.cache, "reader", id, session)
    : new Directory(Paths.cache, "reader", id);
  cache.create({ intermediates: true, idempotent: true });
  const file = new File(
    cache,
    `${page}.${entry.name.split(".").pop()!.toLowerCase()}`,
  );

  if (!file.exists) {
    const reader = open(new File(dir, "archive.cbz"));
    try {
      await file.write(extractPage(reader.read, entry));
    } catch (error) {
      if (file.exists) file.delete();
      throw error;
    } finally {
      reader.close();
    }
  }

  // Conserva somente a página atual e suas vizinhas no cache em disco.
  for (const child of session ? [] : cache.list())
    if (
      child instanceof File &&
      Math.abs(Number(child.name.split(".")[0]) - page) > 1
    )
      child.delete();
  return file.uri;
}

export async function verticalPageSizes(
  id: string,
  canceled: () => boolean,
): Promise<PageSize[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Identificador inválido.");
  const dir = new Directory(root(), id);
  const metadata = new File(dir, "sizes.json");
  if (metadata.exists) return JSON.parse(await metadata.text()) as PageSize[];
  const downloaded = await downloadedPages(dir);

  if (downloaded) {
    const sizes: PageSize[] = [];

    for (const name of downloaded) {
      if (canceled()) throw new Error("Preparação cancelada.");

      sizes.push(imageSize(await new File(dir, name).bytes()));
    }

    await metadata.write(JSON.stringify(sizes));

    return sizes;
  }
  const entries = JSON.parse(
    await new File(dir, "index.json").text(),
  ) as Entry[];
  const reader = open(new File(dir, "archive.cbz"));
  const sizes: PageSize[] = [];
  try {
    for (const entry of entries) {
      if (canceled()) throw new Error("Preparação cancelada.");
      sizes.push(imageSize(extractPage(reader.read, entry)));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!canceled()) await metadata.write(JSON.stringify(sizes));
  } finally {
    reader.close();
  }
  return sizes;
}

/** Uma fila de extração e arquivos retidos somente enquanto a célula está montada. */
export function createVerticalSession(id: string) {
  const session = Crypto.randomUUID();
  const cachePrefix =
    new Directory(Paths.cache, "reader", id, session).uri.replace(/\/$/, "") +
    "/";
  const references = new Map<number, number>();
  const files = new Map<number, string>();
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;

  function discard(page: number) {
    if (references.get(page)) return;
    const uri = files.get(page);
    if (uri) {
      // Páginas baixadas pertencem à biblioteca, não ao cache da sessão.
      if (uri.startsWith(cachePrefix)) {
        const file = new File(uri);
        if (file.exists) file.delete();
      }
      files.delete(page);
    }
  }
  return {
    retain(page: number) {
      references.set(page, (references.get(page) ?? 0) + 1);
      const uri = queue.then(async () => {
        if (closed || !references.get(page))
          throw new Error("Página liberada.");
        const uri = await pageUri(id, page, session);
        files.set(page, uri);
        discard(page);
        return uri;
      });
      queue = uri.catch(() => {});
      let released = false;
      return {
        uri,
        release() {
          if (released) return;
          released = true;
          references.set(page, Math.max(0, (references.get(page) ?? 1) - 1));
          discard(page);
        },
      };
    },
    close() {
      closed = true;
      void queue
        .then(() => {
          const dir = new Directory(Paths.cache, "reader", id, session);
          if (dir.exists) dir.delete();
        })
        .catch((error) =>
          console.warn("Não foi possível limpar o cache vertical:", error),
        );
    },
  };
}

export async function removeBook(db: SQLiteDatabase, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Identificador inválido.");
  await db.runAsync("DELETE FROM books WHERE id = ?", id);
  await db.runAsync("DELETE FROM downloads WHERE bookId = ?", id);

  const dir = new Directory(root(), id);
  if (dir.exists) dir.delete();

  const cache = new Directory(Paths.cache, "reader", id);
  if (cache.exists) cache.delete();
}
