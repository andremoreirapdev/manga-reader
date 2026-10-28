import type { PageReport } from "../../types/manga-source";

/** No máximo dois envios ativos e quatro relatórios pendentes, sem descartar tentativas. */
export function createReportQueue(
  send: ((report: PageReport) => Promise<void>) | undefined,
  observe: (stage: "reportMs" | "reportWaitMs", milliseconds: number, failed?: boolean) => void,
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

        try {
          await send(report);
        } catch {
          failed = true;
        } finally {
          observe("reportMs", Date.now() - started, failed);
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
