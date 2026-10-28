import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LibraryManga } from "./grouping";
import { LibraryIcon } from "./LibraryIcon";
import { readingPosition } from "./selectors";

export function LibraryMangaCard({
  manga,
  featured,
  disabled,
  onOpen,
  onOptions,
}: {
  manga: LibraryManga;
  featured: boolean;
  disabled: boolean;
  onOpen: () => void;
  onOptions: () => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const book = manga.resume;
  const position = readingPosition(book);

  useEffect(() => {
    setCoverFailed(false);
  }, [manga.cover]);

  return (
    <View style={[styles.card, featured && styles.featured]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={manga.isSeries
          ? `${manga.title}. ${manga.chapters.length} capítulos baixados. Abrir detalhes e capítulos.`
          : `${manga.title}. Página ${position.page} de ${book.pages}. Abrir leitor.`}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.cover}>
          {!coverFailed ? (
            <Image
              source={manga.cover}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="disk"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <LibraryIcon name="book" color="#78879c" />
          )}
        </View>
        <View style={styles.details}>
          <Text style={[styles.eyebrow, featured && styles.accent]}>
            {featured
              ? "CONTINUAR LEITURA"
              : manga.source === "mangadex"
                ? "MANGADEX · OFFLINE"
                : "CBZ · NO DISPOSITIVO"}
          </Text>
          <Text style={styles.title} numberOfLines={2}>
            {manga.title}
          </Text>
          <Text style={styles.metadata}>
            {manga.chapters.length} {manga.source === "cbz" ? "arquivo" : manga.chapters.length === 1 ? "capítulo" : "capítulos"} · {manga.pages} páginas
          </Text>
          <View style={styles.progressHeading}>
            <Text style={styles.position} numberOfLines={1}>
              {manga.isSeries ? `Cap. ${book.chapterNumber ?? "especial"} · pág. ${position.page}` : `Página ${position.page}`}
            </Text>
            <Text style={styles.percent}>{position.percent}%</Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Posição no capítulo"
            accessibilityValue={{
              min: 1,
              max: Math.max(1, book.pages),
              now: position.page,
            }}
            style={styles.track}
          >
            <View
              style={[
                styles.fill,
                { width: `${position.percent}%` },
                featured && styles.featuredFill,
              ]}
            />
          </View>
          <Text style={styles.date} numberOfLines={1}>
            Acesso em{" "}
            {new Date(manga.accessed).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
            })}
          </Text>
          {manga.isSeries && (
            <Text style={styles.expandLabel}>Ver detalhes e capítulos</Text>
          )}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Opções de ${manga.title}`}
        disabled={disabled}
        onPress={onOptions}
        style={({ pressed }) => [styles.options, pressed && styles.pressed]}
      >
        <LibraryIcon name="more" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#131d2a",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#233043",
    marginBottom: 12,
    flexDirection: "row",
    overflow: "hidden",
  },
  featured: { borderColor: "#647b40", backgroundColor: "#182225" },
  expandLabel: { color: "#c5ef86", fontSize: 11, marginTop: 5 },
  body: {
    flex: 1,
    flexDirection: "row",
    padding: 14,
    paddingRight: 0,
    gap: 14,
    alignItems: "center",
  },
  cover: {
    width: 78,
    height: 120,
    borderRadius: 9,
    overflow: "hidden",
    backgroundColor: "#243246",
    alignItems: "center",
    justifyContent: "center",
  },
  details: { flex: 1, gap: 5, paddingVertical: 2 },
  eyebrow: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    color: "#93a3b8",
  },
  accent: { color: "#c5ef86" },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "700", color: "#f3f6fa" },
  metadata: { fontSize: 12, color: "#9faec1" },
  progressHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 7,
    gap: 4,
  },
  position: { fontSize: 11, color: "#c9d4e1", flex: 1 },
  percent: { fontSize: 11, color: "#9faec1", fontVariant: ["tabular-nums"] },
  track: {
    height: 4,
    borderRadius: 3,
    backgroundColor: "#2c3b4d",
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 3, backgroundColor: "#8198b7" },
  featuredFill: { backgroundColor: "#c5ef86" },
  date: { fontSize: 10, color: "#8495ab", marginTop: 3 },
  options: { width: 44, minHeight: 48, alignItems: "center", paddingTop: 14 },
  pressed: { opacity: 0.7 },
});
