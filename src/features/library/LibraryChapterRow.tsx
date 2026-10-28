import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Book } from "../../storage/database";
import { LibraryIcon } from "./LibraryIcon";
import { readingPosition } from "./selectors";

export function LibraryChapterRow({ book, last, disabled, onOpen, onOptions }: {
  book: Book;
  last: boolean;
  disabled: boolean;
  onOpen: () => void;
  onOptions: () => void;
}) {
  const position = readingPosition(book);

  return (
    <View style={[styles.row, last && styles.last]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${book.title}`}
        disabled={disabled} onPress={onOpen} style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <Text style={styles.title}>Capítulo {book.chapterNumber ?? "especial"}</Text>
        <Text style={styles.subtitle}>
          {book.chapterLanguage ? `${book.chapterLanguage} · ` : ""}{book.pages} páginas · Página {position.page} · {position.percent}%
        </Text>
        {book.credits && <Text numberOfLines={1} style={styles.credits}>{book.credits}</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Opções de ${book.title}`}
        disabled={disabled} onPress={onOptions} style={({ pressed }) => [styles.options, pressed && styles.pressed]}>
        <LibraryIcon name="more" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", backgroundColor: "#101a26", borderColor: "#233043", borderWidth: 1, borderTopWidth: 0 },
  last: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, marginBottom: 12, overflow: "hidden" },
  body: { flex: 1, minHeight: 76, padding: 14, gap: 5 },
  title: { color: "#eff3f8", fontSize: 14, fontWeight: "600" },
  subtitle: { color: "#a7b3c3", fontSize: 11 },
  credits: { color: "#8190a5", fontSize: 10 },
  options: { width: 48, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.65 },
});
