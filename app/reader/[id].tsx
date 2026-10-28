import { useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Button,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { pageUri } from "../../src/services/library";
import { VerticalReader } from "../../src/features/reader/VerticalReader";
import type { Book } from "../../src/storage/database";

export default function Reader() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const dimensions = useWindowDimensions();
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

  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      book?.mode === "paged" &&
      Math.abs(g.dx) > 25 &&
      Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) > 45) move(g.dx > 0 ? 1 : -1);
    },
  });

  return (
    <View style={styles.screen}>
      <Text style={styles.text}>{book?.title}</Text>
      <View style={styles.toolbar}>
        <Button
          title="← Próxima"
          disabled={loading || !book || book.page >= book.pages - 1}
          onPress={() => move(1)}
        />
        <Text style={styles.text}>
          {book ? `${book.page + 1} / ${book.pages}` : ""}
        </Text>
        <Button
          title="Anterior →"
          disabled={loading || !book || book.page === 0}
          onPress={() => move(-1)}
        />
      </View>
      <Button
        title={
          book?.mode === "vertical"
            ? "Modo: vertical contínuo"
            : "Modo: página a página"
        }
        disabled={!book || loading}
        onPress={() =>
          setBook((b) =>
            b ? { ...b, mode: b.mode === "paged" ? "vertical" : "paged" } : b,
          )
        }
      />
      {loading && <ActivityIndicator />}
      {!!error && (
        <View>
          <Text accessibilityRole="alert" style={styles.text}>
            {error}
          </Text>
          <Button
            title="Tentar novamente"
            onPress={() => setRetry((n) => n + 1)}
          />
        </View>
      )}
      {uri && book?.mode === "paged" && (
        <View style={{ flex: 1 }} {...pan.panHandlers}>
          <Image
            source={uri}
            style={{ flex: 1 }}
            contentFit="contain"
            cachePolicy="none"
            onError={() =>
              setError("Não foi possível decodificar esta imagem.")
            }
          />
          <View style={styles.overlay}>
            <Pressable
              accessibilityLabel="Próxima página"
              style={{ flex: 1 }}
              onPress={() => move(1)}
            />
            <Pressable
              accessibilityLabel="Página anterior"
              style={{ flex: 1 }}
              onPress={() => move(-1)}
            />
          </View>
        </View>
      )}
      {book?.mode === "vertical" && (
        <VerticalReader
          key={`${book.id}-${verticalTarget}`}
          id={book.id}
          count={book.pages}
          initialPage={book.page}
          width={Math.max(1, dimensions.width - 24)}
          onPage={(page) =>
            setBook((b) => (b && b.page !== page ? { ...b, page } : b))
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 12, gap: 10 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  text: { color: "#fff", textAlign: "center" },
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
  },
});
