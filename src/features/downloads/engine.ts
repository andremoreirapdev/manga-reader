import type {
  Chapter,
  ChapterPages,
  Manga,
  MangaSource,
} from "../../types/manga-source";
import type { PageSize } from "../reader/layout";

export type DownloadRequest = { manga: Manga; chapter: Chapter };
export type DownloadPhase = "preparing" | "downloading" | "saving";
export type DownloadProgress = {
  phase: DownloadPhase;
  completed: number;
  total: number;
  bytes: number;
  pageBytes: number;
  pageTotal: number;
};
export type LocalPage = PageSize & { name: string; bytes: number };
export type ChapterStorage = {
  begin(): Promise<void>;
  setTotal(total: number): Promise<void>;
  writePage(
    index: number,
    page: ChapterPages["pages"][number],
    signal: AbortSignal,
    maxBytes: number,
    onBytes: (bytes: number, total: number) => void,
  ): Promise<LocalPage>;
  publish(pages: LocalPage[]): Promise<string>;
  rollback(): Promise<void>;
};

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export function checkCanceled(signal: AbortSignal) {
  if (signal.aborted) {
    const error = new Error("Download cancelado.");
    error.name = "AbortError";
    throw error;
  }
}

export function waitForDownload(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  checkCanceled(signal);

  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      try {
        checkCanceled(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Fluxo independente de React, SQLite e filesystem nativo. */
export async function runChapterDownload(
  request: DownloadRequest,
  source: MangaSource,
  storage: ChapterStorage,
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void,
  wait = waitForDownload,
  now = Date.now,
  observePause: (milliseconds: number) => void = () => {},
) {
  const saved: LocalPage[] = [];
  let bytes = 0;

  if (request.chapter.external || request.chapter.pages === 0) {
    throw new DownloadError(
      "Este capítulo não possui páginas para download nesta fonte.",
    );
  }

  try {
    onProgress({
      phase: "preparing",
      completed: 0,
      total: 0,
      bytes: 0,
      pageBytes: 0,
      pageTotal: 0,
    });
    checkCanceled(signal);
    await storage.begin();
    let manifest = await source.getChapterPages(request.chapter.id, signal);
    const revision = manifest.revision;
    const total = manifest.pages.length;
    await storage.setTotal(total);

    for (let index = 0; index < total; index++) {
      checkCanceled(signal);

      if (now() >= manifest.expiresAt) {
        manifest = await source.getChapterPages(request.chapter.id, signal);

        if (manifest.revision !== revision || manifest.pages.length !== total) {
          throw new DownloadError(
            "O capítulo mudou durante o download. Tente baixá-lo novamente.",
          );
        }
      }

      let complete = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        checkCanceled(signal);

        if (attempt > 0) {
          const waiting = now();
          await wait(attempt * 2000, signal);
          observePause(now() - waiting);
        }

        onProgress({
          phase: "downloading",
          completed: index,
          total,
          bytes,
          pageBytes: 0,
          pageTotal: 0,
        });

        try {
          const page = await storage.writePage(
            index,
            manifest.pages[index],
            signal,
            Math.min(24 * 1024 ** 2, 2 * 1024 ** 3 - bytes),
            (pageBytes, pageTotal) => {
              onProgress({
                phase: "downloading",
                completed: index,
                total,
                bytes,
                pageBytes,
                pageTotal,
              });
            },
          );
          saved.push(page);
          bytes += page.bytes;
          complete = true;
          break;
        } catch (error) {
          checkCanceled(signal);

          if (
            !(error instanceof DownloadError) ||
            !error.retryable ||
            attempt === 2
          ) {
            throw error;
          }

          // A fonte escolhe novamente o servidor; não fixamos hosts de imagens.
          manifest = await source.getChapterPages(request.chapter.id, signal);

          if (
            manifest.revision !== revision ||
            manifest.pages.length !== total
          ) {
            throw new DownloadError(
              "O capítulo mudou durante o download. Tente novamente.",
            );
          }
        }
      }

      if (!complete) {
        throw new DownloadError("Não foi possível concluir a página.");
      }

      onProgress({
        phase: "downloading",
        completed: index + 1,
        total,
        bytes,
        pageBytes: 0,
        pageTotal: 0,
      });
    }

    checkCanceled(signal);
    onProgress({
      phase: "saving",
      completed: saved.length,
      total: saved.length,
      bytes,
      pageBytes: 0,
      pageTotal: 0,
    });

    return await storage.publish(saved);
  } catch (error) {
    try {
      await storage.rollback();
    } catch {
      throw new DownloadError(
        "O download falhou e a limpeza ficou pendente. Reabra o aplicativo para tentar a limpeza novamente.",
      );
    }

    throw error;
  }
}
