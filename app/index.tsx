import { useCallback, useState } from "react";
import { useFocusEffect, router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { listBooks, type Book } from "../src/storage/database";
import { importBook, removeBook } from "../src/services/library";

export default function Library() {
  const db = useSQLiteContext();
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks(db));
    } catch (e) {
      setError(String(e));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function add() {
    setBusy(true);
    setError("");
    try {
      await importBook(db);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function remove(book: Book) {
    Alert.alert(
      "Remover da biblioteca?",
      `Os arquivos de “${book.title}” serão apagados do app.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Remover",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await removeBook(db, book.id);
              await refresh();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Sua biblioteca offline</Text>
      <Text style={styles.muted}>Importe um CBZ e continue de onde parou.</Text>
      <Button title="Importar CBZ" disabled={busy} onPress={() => void add()} />
      {busy && (
        <View>
          <ActivityIndicator />
          <Text style={styles.muted}>Validando arquivo e páginas…</Text>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <FlatList
        data={books}
        keyExtractor={(b) => b.id}
        ListEmptyComponent={
          <Text style={styles.muted}>Nenhum mangá importado.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Pressable
              style={styles.row}
              disabled={busy}
              onPress={() =>
                router.push({
                  pathname: "/reader/[id]",
                  params: { id: item.id },
                })
              }
            >
              <Image
                source={item.cover}
                style={{ width: 64, height: 90 }}
                contentFit="cover"
                cachePolicy="disk"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.muted}>
                  {item.pages} páginas · página {item.page + 1}
                </Text>
                <Text style={styles.muted}>
                  {new Date(item.accessed).toLocaleString("pt-BR")}
                </Text>
              </View>
            </Pressable>
            <Button
              title="Remover"
              disabled={busy}
              onPress={() => remove(item)}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 16 },
  heading: { color: "#fff", fontSize: 24, fontWeight: "700" },
  muted: { color: "#aab7cc", marginVertical: 8 },
  title: { color: "#fff", fontSize: 18 },
  error: { color: "#ffb4ab" },
  card: {
    backgroundColor: "#161c2b",
    padding: 12,
    marginVertical: 6,
    borderRadius: 12,
  },
  row: { flexDirection: "row", gap: 16 },
});
