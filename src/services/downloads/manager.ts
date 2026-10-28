import { Directory, File, FileMode, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import type { MangaSource, PageReport } from "../../types/manga-source";
import {
  runChapterDownload,
  DownloadError,
  type ChapterStorage,
  type DownloadProgress,
  type DownloadRequest,
  type LocalPage,
} from "../../features/downloads/engine";
import { validateDownloadedImage } from "../../features/downloads/validation";
import { receivePage } from "./transfer";
import { createReportOutbox, type ReportQueueState } from "./report-outbox";

export type DownloadStatus =
  | "downloading"
  | "canceling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type DownloadJob = DownloadProgress & {
  request: DownloadRequest;
  chapterId: string;
  bookId: string;
  status: DownloadStatus;
  error: string | null;
  diagnostics?: string;
};
export type DownloadSnapshot = {
  ready: boolean;
  active: DownloadJob | null;
  jobs: Record<string, DownloadJob>;
  error: string | null;
  lastJob?: DownloadJob | null;
  reports?: ReportQueueState;
};
type DownloadRow = {
  chapterId: string;
  request: string;
  bookId: string;
  status: DownloadStatus;
  completed: number;
  total: number;
  error: string | null;
};
const UUID = /^[0-9a-f-]{36}$/i;

function paths(bookId: string) {
  if (!UUID.test(bookId))
    throw new DownloadError("Identificador local de download inválido.");

  return {
    staging: new Directory(Paths.document, "download-staging", bookId),
    final: new Directory(Paths.document, "library", bookId),
  };
}

export function createDownloadManager(db: SQLiteDatabase, source: MangaSource) {
  let snapshot: DownloadSnapshot = {
    ready: false,
    active: null,
    jobs: {},
    error: null,
  };
  const listeners = new Set<() => void>();
  let initializing: Promise<void> | null = null;
  let running = false;
  let initializedOnce = false;
  let controller: AbortController | null = null;
  let cancelReason: "cancelled" | "interrupted" = "cancelled";
  let reportsAllowed = true;
  const reportOutbox = createReportOutbox(db, source, (reports) => {
    update({ ...snapshot, reports });
  });

  function cancellationStatus(): "cancelled" | "interrupted" {
    return cancelReason;
  }

  function update(next: DownloadSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function updateJob(job: DownloadJob, active = true) {
    update({
      ...snapshot,
      active: active ? job : null,
      lastJob: active ? snapshot.lastJob : job,
      jobs: { ...snapshot.jobs, [job.chapterId]: job },
    });
  }

  async function cleanup(bookId: string) {
    const existing = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM books WHERE id = ?",
      bookId,
    );

    if (existing) return;

    const dirs = paths(bookId);

    if (dirs.staging.exists) dirs.staging.delete();
    if (dirs.final.exists) dirs.final.delete();
  }

  function storageFor(
    job: DownloadJob,
    report: NonNullable<MangaSource["reportPage"]>,
    observe: (stage: string, milliseconds: number) => void,
  ): ChapterStorage {
    const dirs = paths(job.bookId);

    return {
      async begin() {
        if (dirs.final.exists)
          throw new DownloadError("O diretório de destino já existe.");

        dirs.staging.create({ intermediates: true });
      },
      async setTotal(total) {
        await db.runAsync(
          "UPDATE downloads SET total = ?, updatedAt = ? WHERE chapterId = ?",
          total,
          Date.now(),
          job.chapterId,
        );
      },
      async writePage(index, page, signal, maxBytes, onBytes) {
        const preparingFiles = Date.now();

        if (!/^(png|jpe?g|webp)$/.test(page.extension))
          throw new DownloadError("Formato de página não suportado.");

        const name = `page-${String(index + 1).padStart(5, "0")}.${page.extension}`;
        const partial = new File(dirs.staging, `${name}.part`);
        const final = new File(dirs.staging, name);

        if (partial.exists) partial.delete();
        observe("filePrepareMs", Date.now() - preparingFiles);

        try {
          observe("attempts", 1);
          const bytes = await receivePage(
            page.url,
            signal,
            maxBytes,
            expoFetch,
            () => {
              partial.create();
              const handle = partial.open(FileMode.WriteOnly);

              return {
                write: (bytes) => handle.writeBytes(bytes),
                close: () => handle.close(),
              };
            },
            onBytes,
            report,
            observe,
            "prefer-native-buffer",
          );
          const validating = Date.now();
          let dimensions;

          try {
            dimensions = validateDownloadedImage(await partial.bytes(), page.extension);
          } finally {
            observe("validationMs", Date.now() - validating);
          }

          const saving = Date.now();
          await partial.move(final);
          await db.runAsync(
            "UPDATE downloads SET completed = ?, updatedAt = ? WHERE chapterId = ?",
            index + 1,
            Date.now(),
            job.chapterId,
          );
          observe("savingMs", Date.now() - saving);

          return { name, bytes, ...dimensions };
        } catch (error) {
          if (partial.exists) partial.delete();

          throw error;
        }
      },
      async publish(pages: LocalPage[]) {
        const publishing = Date.now();
        await new File(dirs.staging, "pages.json").write(
          JSON.stringify(pages.map((page) => page.name)),
        );
        await new File(dirs.staging, "sizes.json").write(
          JSON.stringify(pages.map(({ width, height }) => ({ width, height }))),
        );
        new Directory(Paths.document, "library").create({
          intermediates: true,
          idempotent: true,
        });
        await dirs.staging.move(dirs.final);
        const chapter = job.request.chapter;
        const groups = chapter.groups.join(", ") || "Grupo não informado";
        const title = `${job.request.manga.title} · Cap. ${chapter.number ?? "especial"} · ${chapter.language} · ${groups}`;
        const cover = new File(dirs.final, pages[0].name).uri;
        const credits = `Fonte: ${source.name} · Tradução: ${groups}`;
        await db.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync(
            "INSERT INTO books (id,title,pages,accessed,cover,source,sourceChapterId,credits,sourceMangaId,mangaTitle,chapterNumber,chapterLanguage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            job.bookId,
            title,
            pages.length,
            Date.now(),
            cover,
            source.id,
            chapter.id,
            credits,
            job.request.manga.id,
            job.request.manga.title,
            chapter.number,
            chapter.language,
          );
          await transaction.runAsync(
            "UPDATE downloads SET status = 'completed', completed = ?, total = ?, error = NULL, updatedAt = ? WHERE chapterId = ?",
            pages.length,
            pages.length,
            Date.now(),
            chapter.id,
          );
        });
        observe("publishMs", Date.now() - publishing);

        return job.bookId;
      },
      rollback: () => cleanup(job.bookId),
    };
  }

  async function initialize() {
    if (snapshot.ready) return;
    if (initializing) return initializing;

    initializing = (async () => {
      const rows = await db.getAllAsync<DownloadRow>(
        "SELECT * FROM downloads ORDER BY updatedAt",
      );
      const jobs: Record<string, DownloadJob> = {};

      for (const row of rows) {
        let status = row.status;
        let error = row.error;
        const existing = await db.getFirstAsync<{ id: string }>(
          "SELECT id FROM books WHERE id = ?",
          row.bookId,
        );

        if (status === "completed" && !existing) {
          await db.runAsync(
            "DELETE FROM downloads WHERE chapterId = ?",
            row.chapterId,
          );
          continue;
        }

        if (status !== "completed") {
          await cleanup(row.bookId);

          if (status === "downloading" || status === "canceling") {
            status = "interrupted";
            error =
              "Download interrompido. Toque em tentar novamente para recomeçar.";
            await db.runAsync(
              "UPDATE downloads SET status = ?, error = ? WHERE chapterId = ?",
              status,
              error,
              row.chapterId,
            );
          }
        }

        jobs[row.chapterId] = {
          ...row,
          status,
          error,
          request: JSON.parse(row.request) as DownloadRequest,
          phase: "preparing",
          bytes: 0,
          pageBytes: 0,
          pageTotal: 0,
        };
      }

      const lastJob = initializedOnce
        ? snapshot.lastJob
        : Object.values(jobs)
            .filter((job) => job.status !== "completed")
            .at(-1);
      initializedOnce = true;
      update({ ...snapshot, ready: true, error: null, jobs, lastJob });

      if (reportsAllowed) await reportOutbox.resume();
    })()
      .catch((error) => {
        update({
          ...snapshot,
          error: `Não foi possível preparar os downloads: ${String(error)}`,
        });
        throw error;
      })
      .finally(() => {
        initializing = null;
      });

    return initializing;
  }

  async function start(request: DownloadRequest) {
    if (running) return;

    running = true;
    controller = new AbortController();
    const signal = controller.signal;
    cancelReason = "cancelled";
    let job: DownloadJob = {
      request,
      chapterId: request.chapter.id,
      bookId: Crypto.randomUUID(),
      status: "downloading",
      error: null,
      phase: "preparing",
      completed: 0,
      total: 0,
      bytes: 0,
      pageBytes: 0,
      pageTotal: 0,
    };
    let registered = false;
    const started = Date.now();
    const timings: Record<string, number> = {};
    const failedReports: PageReport[] = [];
    const observe = (stage: string, milliseconds: number) => {
      timings[stage] = (timings[stage] ?? 0) + milliseconds;
    };
    const measuredSource: MangaSource = {
      ...source,
      async getChapterPages(id, signal) {
        const preparing = Date.now();

        try {
          return await source.getChapterPages(id, signal);
        } finally {
          observe("manifestMs", Date.now() - preparing);
        }
      },
    };

    try {
      await initialize();
      const existing = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM books WHERE source = ? AND sourceChapterId = ?",
        source.id,
        request.chapter.id,
      );

      if (existing) {
        updateJob(
          {
            ...job,
            bookId: existing.id,
            status: "completed",
            completed: request.chapter.pages,
            total: request.chapter.pages,
          },
          false,
        );
        return;
      }

      const previous = snapshot.jobs[job.chapterId];

      if (previous) await cleanup(previous.bookId);

      await db.runAsync(
        `INSERT INTO downloads (chapterId,request,status,bookId,completed,total,error,updatedAt) VALUES (?,?,?,?,0,0,NULL,?) ON CONFLICT(chapterId) DO UPDATE SET request=excluded.request,status=excluded.status,bookId=excluded.bookId,completed=0,total=0,error=NULL,updatedAt=excluded.updatedAt`,
        job.chapterId,
        JSON.stringify(request),
        "downloading",
        job.bookId,
        Date.now(),
      );
      registered = true;
      updateJob(job);
      let lastUpdate = 0;
      const storage = storageFor(job, async (report) => {
        if (source.reportPage && report.success === false) failedReports.push(report);
      }, observe);
      const measuredStorage: ChapterStorage = {
        ...storage,
        async writePage(...args) {
          const startedPage = Date.now();

          try {
            const page = await storage.writePage(...args);
            // Uma página recuperada não deve gerar relatório se o capítulo concluir.
            failedReports.length = 0;

            return page;
          } finally {
            observe("pageMs", Date.now() - startedPage);
          }
        },
      };
      const bookId = await runChapterDownload(
        request,
        measuredSource,
        measuredStorage,
        signal,
        (progress) => {
          const updating = Date.now();
          const important =
            progress.phase !== job.phase ||
            progress.completed !== job.completed;
          job = {
            ...job,
            ...progress,
            status: signal.aborted ? "canceling" : "downloading",
          };

          if (important || Date.now() - lastUpdate > 180) {
            lastUpdate = Date.now();
            updateJob(job);
          }

          observe("progressMs", Date.now() - updating);
        },
        undefined,
        undefined,
        (milliseconds) => observe("pauseMs", milliseconds),
      );
      job = { ...job, bookId, status: "completed" };
    } catch (error) {
      const canceledStatus = cancellationStatus();
      job = {
        ...job,
        status: signal.aborted ? canceledStatus : "failed",
        error: signal.aborted
          ? canceledStatus === "interrupted"
            ? "Download interrompido ao sair do app. Tente novamente para recomeçar."
            : "Download cancelado."
          : error instanceof Error
            ? error.message
            : String(error),
      };

      if (job.status === "failed") {
        for (const report of failedReports) {
          try {
            await reportOutbox.enqueue(job.chapterId, report);
            observe("reportsQueued", 1);
          } catch {
            observe("reportPersistFailures", 1);
          }
        }
      }

      if (registered) {
        try {
          await db.runAsync(
            "UPDATE downloads SET status = ?, error = ?, updatedAt = ? WHERE chapterId = ?",
            job.status,
            job.error,
            Date.now(),
            job.chapterId,
          );
        } catch {
          job = {
            ...job,
            error: `${job.error} Não foi possível registrar o estado; reabra o app para recuperar.`,
          };
        }
      }

      updateJob(job, false);
    } finally {
      if (registered) {
        const seconds = (key: string) => ((timings[key] ?? 0) / 1000).toFixed(1);
        const elapsed = Date.now() - started;
        const pageStages = ["headersMs", "metadataMs", "bodySetupMs", "readMs", "writeMs", "cleanupMs", "fileOpenMs", "filePrepareMs", "reportEnqueueMs", "validationMs", "savingMs"];
        const pageDetails = pageStages.reduce((sum, key) => sum + (timings[key] ?? 0), 0);
        const diagnostics = [
          `Tempo total: ${(elapsed / 1000).toFixed(1)} s · Tentativas de página: ${timings.attempts ?? 0}`,
          `Servidor (até cabeçalhos): ${seconds("headersMs")} s · Recebimento: ${seconds("readMs")} s`,
          `Leitura de metadados da resposta: ${seconds("metadataMs")} s · Preparação do stream: ${seconds("bodySetupMs")} s`,
          `Método de leitura: ${timings.nativeBufferPages ?? 0} páginas em buffer nativo (até 4 MiB) · ${timings.streamPages ?? 0} páginas em stream JS`,
          `Gravação: ${seconds("writeMs")} s · Validação: ${seconds("validationMs")} s · Arquivos/banco: ${seconds("savingMs")} s`,
          `Fechamento da transferência: ${seconds("cleanupMs")} s · Publicação: ${seconds("publishMs")} s`,
          `Preparação dos arquivos: ${seconds("filePrepareMs")} s · Criação/abertura: ${seconds("fileOpenMs")} s · Enfileiramento de relatórios: ${seconds("reportEnqueueMs")} s`,
          `Processamento completo das páginas: ${seconds("pageMs")} s (inclui transferência, arquivos e enfileiramento) · Atualizações de progresso: ${seconds("progressMs")} s (podem ocorrer dentro das páginas)`,
          `Outros tempos dentro das páginas: ${(Math.max(0, (timings.pageMs ?? 0) - pageDetails) / 1000).toFixed(1)} s · Tempo fora das páginas: ${(Math.max(0, elapsed - (timings.pageMs ?? 0)) / 1000).toFixed(1)} s (inclui preparação, consultas, pausas e finalização)`,
          `Consulta à fonte: ${seconds("manifestMs")} s · Pausas: ${seconds("pauseMs")} s`,
          `Relatórios: apenas capítulos com falha · ${timings.reportsQueued ?? 0} falhas de imagem registradas · Falhas ao registrar: ${timings.reportPersistFailures ?? 0}`,
          "O tempo total termina ao concluir o download e não aguarda o envio dos relatórios.",
        ].join("\n");
        job = { ...job, diagnostics };
        console.info("[Download]", job.status, diagnostics);
        updateJob(job, false);
      }

      running = false;
      controller = null;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize,
    start,
    setReportsActive(active: boolean) {
      reportsAllowed = active;

      if (!active) reportOutbox.pause();
      else if (snapshot.ready) void reportOutbox.resume();
    },
    cancel(reason: "cancelled" | "interrupted" = "cancelled") {
      if (!controller || snapshot.active?.phase === "saving") return;

      cancelReason = reason;
      controller.abort();

      if (snapshot.active)
        updateJob({ ...snapshot.active, status: "canceling" });
    },
    dismiss() {
      update({ ...snapshot, lastJob: null });
    },
    async refresh() {
      if (running) return;

      update({ ...snapshot, ready: false });
      await initialize();
    },
  };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;
