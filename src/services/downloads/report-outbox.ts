import type { SQLiteDatabase } from "expo-sqlite";
import type { MangaSource, PageReport } from "../../types/manga-source";
import { reportFailureReason } from "./reports";

export type ReportQueueState = {
  pending: number;
  failed: number;
  sent: number;
  active: boolean;
  paused: boolean;
  lastError: string | null;
  nextAttemptAt: number | null;
};
type ReportRow = { id: number; payload: string; attempts: number };
type Schedule = (callback: () => void, milliseconds: number) => () => void;
const MAX_ATTEMPTS = 3;

function processingError(stage: string, error: unknown) {
  const raw = error && typeof error === "object" && "message" in error
    ? String(error.message) : typeof error === "string" ? error : "Erro sem detalhes.";
  const detail = raw.replace(/https?:\/\/[^\s"')]+/gi, "[endereço omitido]").replace(/\s+/g, " ").slice(0, 500);

  return `Falha na fila (${stage}): ${detail}`;
}

function schedule(callback: () => void, milliseconds: number) {
  const timer = setTimeout(callback, milliseconds);
  timer.unref?.();

  return () => clearTimeout(timer);
}

/** Caixa de saída em disco: um envio por vez, independente do download. */
export function createReportOutbox(
  db: SQLiteDatabase,
  source: MangaSource,
  onChange: (state: ReportQueueState) => void,
  options: { now?: () => number; schedule?: Schedule } = {},
) {
  const now = options.now ?? Date.now;
  const later = options.schedule ?? schedule;
  let state: ReportQueueState = {
    pending: 0, failed: 0, sent: 0, active: false, paused: true, lastError: null, nextAttemptAt: null,
  };
  let enabled = false;
  let running = false;
  let wakeRequested = false;
  let cancelWake: (() => void) | undefined;

  function update(patch: Partial<ReportQueueState>) {
    state = { ...state, ...patch };
    onChange(state);
  }

  async function discardSuccessfulReports() {
    let cursor = 0;

    while (true) {
      const rows = await db.getAllAsync<{ id: number; payload: string }>(
        "SELECT id,payload FROM page_reports WHERE source = ? AND id > ? ORDER BY id LIMIT 100",
        source.id, cursor,
      );

      if (rows.length === 0) return;

      const ids = rows.filter((row) => {
        try {
          return JSON.parse(row.payload)?.success === true;
        } catch {
          return false;
        }
      }).map((row) => row.id);

      if (ids.length > 0) {
        await db.runAsync(`DELETE FROM page_reports WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
      }

      cursor = rows[rows.length - 1].id;
    }
  }

  async function refresh() {
    const counts = await db.getFirstAsync<{ pending: number; failed: number }>(
      "SELECT COALESCE(SUM(CASE WHEN attempts < 3 THEN 1 ELSE 0 END),0) AS pending, COALESCE(SUM(CASE WHEN attempts >= 3 THEN 1 ELSE 0 END),0) AS failed FROM page_reports WHERE source = ?",
      source.id,
    );
    const pending = counts?.pending ?? 0;
    const failed = counts?.failed ?? 0;
    update({ pending, failed, ...(pending + failed === 0 ? { lastError: null } : {}) });
  }

  function wake(milliseconds = 0) {
    if (!enabled || !source.reportPage) return;

    if (running) {
      wakeRequested = true;
      return;
    }

    cancelWake?.();
    update({ nextAttemptAt: now() + milliseconds });
    cancelWake = later(() => {
      cancelWake = undefined;
      update({ nextAttemptAt: null });
      void processNext();
    }, milliseconds);
  }

  async function processNext() {
    if (!enabled || running || !source.reportPage) return;

    running = true;
    let delay: number | undefined;
    let stage = "consultar pausa da fonte";

    try {
      const limit = await db.getFirstAsync<{ retryAt: number }>(
        "SELECT retryAt FROM page_report_limits WHERE source = ?", source.id,
      );

      if (limit && limit.retryAt > now()) {
        delay = limit.retryAt - now();
        return;
      }

      stage = "consultar próximo relatório";
      const row = await db.getFirstAsync<ReportRow>(
        "SELECT id,payload,attempts FROM page_reports WHERE source = ? AND attempts < ? AND nextAttemptAt <= ? ORDER BY nextAttemptAt,id LIMIT 1",
        source.id, MAX_ATTEMPTS, now(),
      );

      if (row && enabled) {
        const attempt = row.attempts + 1;
        // Registre antes da rede: fechamento forçado não perde a tentativa nem a pausa.
        const retryAt = now() + (attempt === 1 ? 30000 : 120000);
        stage = "registrar tentativa";
        await db.runAsync(
          "UPDATE page_reports SET attempts = ?, nextAttemptAt = ? WHERE id = ?",
          attempt, retryAt, row.id,
        );

        if (!enabled) return;

        update({ active: true });

        try {
          stage = "enviar relatório";
          const report = JSON.parse(row.payload) as PageReport;

          if (report.success === false) await source.reportPage(report);

          stage = "confirmar envio";
          await db.runAsync("DELETE FROM page_reports WHERE id = ?", row.id);
          update({ sent: state.sent + (report.success === false ? 1 : 0), lastError: null });
        } catch (error) {
          const reason = reportFailureReason(error);

          if (error && typeof error === "object" && "retryAt" in error &&
            typeof error.retryAt === "number" && Number.isFinite(error.retryAt)) {
            stage = "registrar pausa da fonte";
            await db.runAsync(
              "INSERT INTO page_report_limits(source,retryAt) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET retryAt = MAX(retryAt,excluded.retryAt)",
              source.id, error.retryAt,
            );
          }

          stage = "registrar falha do envio";
          await db.runAsync("UPDATE page_reports SET lastError = ? WHERE id = ?", reason, row.id);
          update({ lastError: reason });
        }
      }

      stage = "contar relatórios pendentes";
      await refresh();
      stage = "agendar próximo relatório";
      const next = await db.getFirstAsync<{ due: number | null }>(
        "SELECT MIN(nextAttemptAt) AS due FROM page_reports WHERE source = ? AND attempts < ?",
        source.id, MAX_ATTEMPTS,
      );

      if (next?.due != null) delay = Math.max(0, next.due - now());
    } catch (error) {
      const message = processingError(stage, error);
      console.warn("[Relatórios]", message);
      update({ lastError: message });
      delay = 30000;
    } finally {
      running = false;
      update({ active: false });

      if (wakeRequested) {
        wakeRequested = false;
        wake();
      } else if (delay !== undefined) wake(delay);
    }
  }

  return {
    getSnapshot: () => state,
    async enqueue(chapterId: string, report: PageReport) {
      if (!source.reportPage || report.success !== false) return;

      await db.runAsync(
        "INSERT INTO page_reports(source,chapterId,payload,nextAttemptAt) VALUES (?,?,?,?)",
        source.id, chapterId, JSON.stringify(report), now(),
      );
      await refresh();
      wake();
    },
    async resume() {
      enabled = true;
      update({ paused: false });

      try {
        await discardSuccessfulReports();
        await refresh();
        wake();
      } catch (error) {
        update({ lastError: processingError("recuperar pendentes", error) });
        wake(30000);
      }
    },
    pause() {
      enabled = false;
      wakeRequested = false;
      cancelWake?.();
      cancelWake = undefined;
      update({ paused: true, nextAttemptAt: null });
    },
  };
}
