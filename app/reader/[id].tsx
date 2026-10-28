import { useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Button,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import type { Book } from "../../src/storage/database";
import { pageUri } from "../../src/services/library";
export default function Reader() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const dimensions = useWindowDimensions();
  const [book, setBook] = useState<Book | null>(null),
    [uri, setUri] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [imageRatio, setImageRatio] = useState(1.5);
  const [retry, setRetry] = useState(0);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    let active = true;
    db.getFirstAsync<Book>("SELECT * FROM books WHERE id = ?", id)
      .then((b) => {
        if (active) {
          if (!b) {
            setError("Item não encontrado.");
            setLoading(false);
          } else setBook(b);
        }
      })
      .catch((e) => {
        if (active) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [db, id]);
  useEffect(() => {
    if (!book) return;
    let active = true;
    setLoading(true);
    setError("");
    setUri("");
    async function load() {
      try {
        const next = await pageUri(book!.id, book!.page);
        await db.runAsync(
          "UPDATE books SET page = ?, mode = ?, accessed = ? WHERE id = ?",
          book!.page,
          book!.mode,
          Date.now(),
          book!.id,
        );
        if (active) {
          setUri(next);
          scroll.current?.scrollTo({ y: 0, animated: false });
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [book, db, retry]);
  function move(delta: number) {
    if (loading) return;
    setBook((b) =>
      b
        ? { ...b, page: Math.max(0, Math.min(b.pages - 1, b.page + delta)) }
        : b,
    );
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
  const height = Math.max(180, dimensions.height - 230);
  return (
    <View style={s.screen}>
      <Text style={s.text}>{book?.title}</Text>
      <View style={s.toolbar}>
        <Button
          title="← Próxima"
          disabled={loading || !book || book.page >= book.pages - 1}
          onPress={() => move(1)}
        />
        <Text style={s.text}>
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
          book?.mode === "vertical" ? "Modo: vertical" : "Modo: página a página"
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
          <Text accessibilityRole="alert" style={s.text}>
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
          <View style={s.overlay}>
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
      {uri && book?.mode === "vertical" && (
        <ScrollView ref={scroll}>
          <Image
            source={uri}
            style={{
              width: "100%",
              height: Math.max(height, (dimensions.width - 24) * imageRatio),
            }}
            contentFit="contain"
            cachePolicy="none"
            onLoad={(event) => {
              const { width, height: h } = event.source;
              if (width > 0) setImageRatio(h / width);
            }}
            onError={() =>
              setError("Não foi possível decodificar esta imagem.")
            }
          />
          <Text style={s.text}>Use “Próxima” ao terminar esta página.</Text>
        </ScrollView>
      )}
    </View>
  );
}
const s = StyleSheet.create({
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
