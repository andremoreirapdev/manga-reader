import type { PageReport } from "../../types/manga-source";

function failureReason(error: unknown): string {
  if (error && typeof error === "object") {
    if ("status" in error && typeof error.status === "number" && error.status >= 100 && error.status <= 599) {
      return `HTTP ${error.status}`;
    }

    if ("name" in error && error.name === "ReportTimeoutError") {
      return "Tempo limite (5 s)";
    }

    if ("name" in error && error.name === "ReportNetworkError") {
      return "Conexão/rede";
    }
  }

  return "Falha não identificada";
}

/** No máximo dois envios ativos e quatro relatórios pendentes, sem descartar tentativas. */
export function createReportQueue(
  send: ((report: PageReport) => Promise<void>) | undefined,
  observe: (stage: "reportMs" | "reportWaitMs", milliseconds: number, failed?: boolean, reason?: string) => void,
) {
  const pending = new Set<Promise<void>>();
  const tail: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
  let next = 0;

  return {
    async enqueue(report: PageReport) {
      if (!send) return;

      const waiting = Date.now();

      while (pending.size >= 4) {
        await Promise.race(pending);
      }

      observe("reportWaitMs", Date.now() - waiting);
      const lane = next++ % tail.length;
      const task = tail[lane].then(async () => {
        const started = Date.now();
        let failed = false;
        let reason: string | undefined;

        try {
          await send(report);
        } catch (error) {
          failed = true;
          reason = failureReason(error);
        } finally {
          observe("reportMs", Date.now() - started, failed, reason);
        }
      });
      tail[lane] = task;
      pending.add(task);
      void task.then(() => pending.delete(task));
    },
    async drain() {
      await Promise.all(tail);
    },
  };
}
