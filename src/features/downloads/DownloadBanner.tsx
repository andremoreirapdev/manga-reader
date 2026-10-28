import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import { useDownloads } from "../../providers/downloads";

function DownloadDiagnostics({ value, label = "Ver diagnóstico do download" }: { value: string; label?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { snapshot } = useDownloads();
  const reports = snapshot.reports;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={styles.action}
      >
        <Text style={styles.actionText}>
          {expanded ? "Ocultar diagnóstico" : label}
        </Text>
      </Pressable>
      {expanded && (
        <>
          <Text selectable style={styles.muted}>{value}</Text>
          {reports && (
            <Text selectable style={styles.muted}>
              Relatórios (fila atual): {reports.pending} pendentes · {reports.failed} sem novas tentativas · {reports.sent} enviados nesta sessão.
              {reports.active ? " Enviando…" : reports.paused ? " Pausada até o app ficar ativo." : ""}
              {!reports.paused && !reports.active && reports.nextAttemptAt != null
                ? ` Próxima verificação: ${new Date(reports.nextAttemptAt).toLocaleTimeString("pt-BR")}.` : ""}
              {reports.lastError ? ` Última falha: ${reports.lastError}.` : ""}
            </Text>
          )}
        </>
      )}
    </>
  );
}

export function DownloadBanner() {
  const { manager, snapshot } = useDownloads();
  const job = snapshot.active;

  if (snapshot.error) {
    return (
      <View style={styles.card}>
        <Text style={styles.error}>{snapshot.error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void manager.initialize().catch(() => {})}
          style={styles.action}
        >
          <Text style={styles.actionText}>
            Tentar preparar downloads novamente
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!job) {
    const last = snapshot.lastJob;

    if (!last) {
      if (!snapshot.reports || snapshot.reports.pending + snapshot.reports.failed === 0) return null;

      return (
        <View style={styles.card}>
          <DownloadDiagnostics
            label="Ver diagnóstico dos relatórios"
            value="Os relatórios salvos no dispositivo não impedem a leitura dos capítulos disponíveis offline."
          />
        </View>
      );
    }

    return (
      <View style={styles.card}>
        <Text style={styles.title} numberOfLines={2}>
          {last.request.manga.title} · Cap.{" "}
          {last.request.chapter.number ?? "especial"}
        </Text>
        <Text style={last.status === "completed" ? styles.heading : styles.error}>
          {last.status === "completed"
            ? "Download concluído. Pronto para ler offline."
            : last.error}
        </Text>
        {last.diagnostics && (
          <DownloadDiagnostics key={last.bookId} value={last.diagnostics} />
        )}
        {last.status !== "completed" && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void manager.start(last.request)}
            style={styles.action}
          >
            <Text style={styles.actionText}>Tentar download novamente</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => manager.dismiss()}
          style={styles.action}
        >
          <Text style={styles.actionText}>Fechar aviso</Text>
        </Pressable>
      </View>
    );
  }

  const fraction =
    job.pageTotal > 0 ? Math.min(job.pageBytes / job.pageTotal, 0.99) : 0;
  const percent =
    job.total > 0
      ? Math.min(99, Math.floor(((job.completed + fraction) / job.total) * 100))
      : 0;

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <ActivityIndicator color="#c5ef86" />
        <Text style={styles.heading}>
          {job.phase === "saving"
            ? "Salvando capítulo…"
            : job.status === "canceling"
              ? "Cancelando…"
              : job.phase === "preparing"
                ? "Preparando download…"
                : `Baixando · ${percent}%`}
        </Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {job.request.manga.title} · Cap.{" "}
        {job.request.chapter.number ?? "especial"}
      </Text>
      <Text style={styles.muted}>
        {job.completed} de {job.total || "…"} páginas ·{" "}
        {((job.bytes + job.pageBytes) / 1024 ** 2).toFixed(1)} MiB
      </Text>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
      <Text style={styles.muted}>Mantenha o app aberto até concluir.</Text>
      {job.phase !== "saving" && job.status !== "canceling" && (
        <Pressable
          accessibilityRole="button"
          onPress={() => manager.cancel()}
          style={styles.action}
        >
          <Text style={styles.actionText}>Cancelar download</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#4a623a",
    backgroundColor: "#1a2925",
    gap: 8,
    marginBottom: 12,
  },
  heading: { color: "#d7f3b2", fontSize: 14, fontWeight: "700", flex: 1 },
  title: { color: "#f3f6fa", fontSize: 13, lineHeight: 19 },
  muted: { color: "#aabcae", fontSize: 11, lineHeight: 17 },
  track: {
    height: 4,
    backgroundColor: "#344633",
    borderRadius: 4,
    overflow: "hidden",
  },
  fill: { height: 4, backgroundColor: "#c5ef86" },
  action: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  actionText: { color: "#d7f3b2", fontSize: 12, fontWeight: "600" },
  error: { color: "#ffb4ab", fontSize: 12, lineHeight: 19 },
});
