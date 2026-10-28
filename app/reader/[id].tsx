import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { pageUri } from "../../src/services/library";
import { VerticalReader } from "../../src/features/reader/VerticalReader";
import type { Book } from "../../src/storage/database";
import { ZoomablePage } from "../../src/features/reader/ZoomablePage";
import { ReaderButton } from "../../src/features/reader/ReaderButton";

export default function Reader() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const dimensions = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [book, setBook] = useState<Book | null>(null);
  const [uri, setUri] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [verticalTarget, setVerticalTarget] = useState(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    db.getFirstAsync<Book>("SELECT * FROM books WHERE id = ?", id)
      .then((value) => {
        if (!active) return;
        if (!value) {
          setError("Item não encontrado.");
          setLoading(false);
          return;
        }
        setBook(value);
      })
      .catch((error) => {
        if (active) {
          setError(String(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [db, id]);

  // A fila mantém a ordem das gravações mesmo durante rolagem rápida.
  useEffect(() => {
    if (!book) return;
    const { id, page, mode } = book;
    writes.current = writes.current
      .then(() =>
        db.runAsync(
          "UPDATE books SET page = ?, mode = ?, accessed = ? WHERE id = ?",
          page,
          mode,
          Date.now(),
          id,
        ),
      )
      .catch((error) =>
        setError(`Não foi possível salvar o progresso: ${String(error)}`),
      );
  }, [db, book?.id, book?.page, book?.mode]);

  useEffect(() => {
    if (!book) return;
    let active = true;
    setUri("");
    setError("");
    if (book.mode === "vertical") {
      setLoading(false);
      return;
    }
    setLoading(true);
    pageUri(book.id, book.page)
      .then((uri) => {
        if (active) setUri(uri);
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [book?.id, book?.mode, book?.mode === "paged" ? book.page : null, retry]);

  function move(delta: number) {
    if (loading) return;
    setBook((b) =>
      b
        ? { ...b, page: Math.max(0, Math.min(b.pages - 1, b.page + delta)) }
        : b,
    );
    setVerticalTarget((n) => n + 1);
  }

  return (
    <View style={[styles.screen, {
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
      paddingLeft: insets.left,
      paddingRight: insets.right,
    }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <View style={styles.header}>
        <ReaderButton label="‹ Voltar" onPress={() => router.back()} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.eyebrow}>MANGAREADER · LEITOR</Text>
          <Text numberOfLines={1} style={styles.title}>{book?.title ?? "Abrindo capítulo…"}</Text>
          {!!book?.credits && <Text numberOfLines={1} style={styles.muted}>{book.credits}</Text>}
        </View>
      </View>
      <View style={styles.modes}>
        <ReaderButton label="Página a página" selected={book?.mode === "paged"} disabled={!book || loading} onPress={() => setBook((b) => b ? { ...b, mode: "paged" } : b)} />
        <ReaderButton label="Vertical contínuo" selected={book?.mode === "vertical"} disabled={!book || loading} onPress={() => setBook((b) => b ? { ...b, mode: "vertical" } : b)} />
      </View>
      <Text style={styles.hint}>{book?.mode === "vertical" ? "Role para ler · Toque em Ampliar para usar o zoom" : "Deslize → próxima · ← anterior · Pinça para ampliar"}</Text>
      {loading && <View style={styles.center}><ActivityIndicator color="#c5ef86" /><Text style={styles.muted}>Preparando página…</Text></View>}
      {!!error && (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={{ color: "#ffb4ab" }}>
            {error}
          </Text>
          <ReaderButton
            label="Tentar novamente"
            onPress={() => setRetry((n) => n + 1)}
          />
        </View>
      )}
      {!!uri && !error && book?.mode === "paged" && (
        <ZoomablePage
          key={uri}
          uri={uri}
          page={book.page}
          onMove={move}
          onError={() =>
            setError("Não foi possível decodificar esta imagem.")
          }
        />
      )}
      {book?.mode === "vertical" && (
        <VerticalReader
          key={`${book.id}-${verticalTarget}`}
          id={book.id}
          count={book.pages}
          initialPage={book.page}
          width={Math.max(1, dimensions.width - insets.left - insets.right)}
          onPage={(page) =>
            setBook((b) => (b && b.page !== page ? { ...b, page } : b))
          }
        />
      )}
      <View style={styles.footer}>
        <View style={styles.track}><View style={[styles.progress, { width: `${book ? (book.page + 1) / book.pages * 100 : 0}%` }]} /></View>
        <View style={styles.toolbar}>
          <ReaderButton label="← Próxima" disabled={loading || !book || book.page >= book.pages - 1} onPress={() => move(1)} />
          <View style={{ alignItems: "center", gap: 2 }}>
            <Text style={styles.counter}>{book ? `${book.page + 1} / ${book.pages}` : "—"}</Text>
            <Text style={styles.muted}>PÁGINAS</Text>
          </View>
          <ReaderButton label="Anterior →" disabled={loading || !book || book.page === 0} onPress={() => move(-1)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0d1521" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  eyebrow: { color: "#a9b995", fontSize: 9, letterSpacing: 2, fontWeight: "700" },
  title: { color: "#f1f5f9", fontSize: 16, fontWeight: "700" },
  modes: { flexDirection: "row", gap: 8, paddingHorizontal: 16 },
  hint: { color: "#9faec1", fontSize: 11, textAlign: "center", paddingHorizontal: 12, paddingVertical: 9 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  muted: { color: "#9faec1", fontSize: 10 },
  error: { padding: 16, gap: 12, flex: 1, justifyContent: "center" },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 10, borderTopWidth: 1, borderColor: "#233043" },
  track: { height: 3, borderRadius: 2, backgroundColor: "#29384a", overflow: "hidden" },
  progress: { height: "100%", backgroundColor: "#c5ef86" },
  counter: { color: "#f1f5f9", fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
