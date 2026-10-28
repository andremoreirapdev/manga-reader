import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack, useFocusEffect, router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { listBooks, type Book } from "../src/storage/database";
import { importBook, removeBook } from "../src/services/library";
import { LibraryMangaCard } from "../src/features/library/LibraryMangaCard";
import { LibraryChapterRow } from "../src/features/library/LibraryChapterRow";
import { groupBooks, libraryRows, selectMangas, type LibraryManga, type LibraryRow } from "../src/features/library/grouping";
import {
  LibraryActionSheet,
  type SheetAction,
} from "../src/features/library/LibraryActionSheet";
import { LibraryIcon } from "../src/features/library/LibraryIcon";
import { useDownloads } from "../src/providers/downloads";
import { DownloadBanner } from "../src/features/downloads/DownloadBanner";
import {
  type LibraryFilter,
  type LibrarySort,
} from "../src/features/library/selectors";

type SheetState =
  { kind: "sort" } | { kind: "manga"; manga: LibraryManga } | { kind: "options" | "remove"; book: Book } | null;

export default function Library() {
  const db = useSQLiteContext();
  const downloads = useDownloads();
  const completedDownloads = Object.values(downloads.snapshot.jobs).filter(
    (job) => job.status === "completed",
  ).length;
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<LibraryRow>>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [operation, setOperation] = useState<"import" | "remove" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const busy = operation !== null;
  const mangas = useMemo(() => groupBooks(books), [books]);
  const reading = mangas.filter((manga) => manga.inProgress);
  const featured = [...reading].sort((a, b) => b.resume.accessed - a.resume.accessed)[0]?.id;
  const visible = useMemo(
    () => selectMangas(mangas, query, filter, sort),
    [mangas, query, filter, sort],
  );
  const rows = useMemo(() => libraryRows(visible, expanded), [visible, expanded]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      setBooks(await listBooks(db));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    if (downloads.snapshot.ready) void refresh();
  }, [completedDownloads, downloads.snapshot.ready, refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  function open(book: Book) {
    Keyboard.dismiss();
    router.push({ pathname: "/reader/[id]", params: { id: book.id } });
  }

  function toggle(manga: LibraryManga) {
    Keyboard.dismiss();

    if (!manga.isSeries) {
      open(manga.resume);
      return;
    }

    setExpanded((previous) => {
      const next = new Set(previous);

      if (next.has(manga.id)) next.delete(manga.id);
      else next.add(manga.id);

      return next;
    });
  }

  function explore() {
    Keyboard.dismiss();
    router.push("/catalog");
  }

  async function add() {
    Keyboard.dismiss();
    setOperation("import");
    setError("");

    try {
      const imported = await importBook(db);

      if (imported) {
        setQuery("");
        setFilter("all");
        setSort("recent");
        await refresh();
        list.current?.scrollToOffset({ offset: 0, animated: true });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperation(null);
    }
  }

  async function remove(book: Book) {
    setSheet(null);
    setOperation("remove");
    setError("");

    try {
      await removeBook(db, book.id);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperation(null);
    }
  }

  function options(book: Book) {
    Keyboard.dismiss();
    setSheet({ kind: "options", book });
  }

  function mangaOptions(manga: LibraryManga) {
    Keyboard.dismiss();

    if (manga.isSeries) setSheet({ kind: "manga", manga });
    else options(manga.resume);
  }

  function chooseSort() {
    Keyboard.dismiss();
    setSheet({ kind: "sort" });
  }

  const sheetActions: SheetAction[] =
    sheet?.kind === "sort"
      ? [
          {
            label: "Último acesso",
            description: "Suas leituras mais recentes primeiro.",
            selected: sort === "recent",
            onPress: () => {
              setSort("recent");
              setSheet(null);
            },
          },
          {
            label: "Título: A–Z",
            description: "Organize os títulos em ordem alfabética.",
            selected: sort === "title",
            onPress: () => {
              setSort("title");
              setSheet(null);
            },
          },
        ]
      : sheet?.kind === "manga"
        ? [
            { label: "Continuar leitura", description: "Abra o capítulo com progresso salvo ou o primeiro ainda não iniciado.",
              onPress: () => { setSheet(null); open(sheet.manga.resume); } },
            { label: "Ver capítulos baixados", description: `${sheet.manga.chapters.length} capítulos disponíveis offline.`,
              onPress: () => {
                setExpanded((previous) => new Set(previous).add(sheet.manga.id));
                setSheet(null);
              } },
          ]
      : sheet?.kind === "options"
        ? [
            {
              label: "Abrir leitura",
              description: "Continue da página que ficou salva.",
              onPress: () => {
                setSheet(null);
                open(sheet.book);
              },
            },
            {
              label: sheet.book.source === "mangadex" ? "Remover capítulo" : "Remover item",
              description: "Remova somente este item da biblioteca local.",
              destructive: true,
              onPress: () => setSheet({ kind: "remove", book: sheet.book }),
            },
          ]
        : sheet?.kind === "remove"
          ? [
              {
                label: "Sim, remover da biblioteca",
                description:
                  "Apaga os arquivos do app. O CBZ original é preservado.",
                destructive: true,
                onPress: () => void remove(sheet.book),
              },
            ]
          : [];
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <LibraryActionSheet
        visible={sheet !== null}
        title={
          sheet?.kind === "sort"
            ? "Ordenar biblioteca"
            : sheet?.kind === "remove"
              ? "Remover da biblioteca?"
              : sheet?.kind === "manga" ? sheet.manga.title : (sheet?.book.title ?? "")
        }
        description={
          sheet?.kind === "sort"
            ? "Escolha a ordem que funciona melhor para você."
            : sheet?.kind === "remove"
              ? `Deseja remover “${sheet.book.title}”?`
              : "O que você quer fazer com esta leitura?"
        }
        actions={sheetActions}
        onClose={() => setSheet(null)}
      />
      <View style={styles.header}>
        <DownloadBanner />
        <View style={styles.headingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>MANGAREADER</Text>
            <Text style={styles.heading}>Minha biblioteca</Text>
            <Text style={styles.subtitle}>
              {mangas.length === 0
                ? "Suas histórias, no seu ritmo."
                : `${mangas.length} ${mangas.length === 1 ? "título disponível" : "títulos disponíveis"} offline`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Importar arquivo CBZ"
            disabled={busy}
            onPress={() => void add()}
            style={({ pressed }) => [
              styles.importAction,
              (pressed || busy) && styles.dim,
            ]}
          >
            <View style={styles.importIcon}>
              {operation === "import" ? (
                <ActivityIndicator color="#172414" />
              ) : (
                <LibraryIcon name="plus" color="#172414" />
              )}
            </View>
            <Text style={styles.importLabel}>Importar</Text>
          </Pressable>
        </View>
        <View style={styles.search}>
          <LibraryIcon name="search" />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar na biblioteca"
            placeholderTextColor="#8190a5"
            accessibilityLabel="Buscar títulos na biblioteca local"
            editable={!busy}
            autoCorrect={false}
            maxLength={150}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {!!query && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpar busca"
              onPress={() => setQuery("")}
              style={styles.clear}
            >
              <LibraryIcon name="close" />
            </Pressable>
          )}
        </View>
        <View style={styles.filters}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: filter === "all" }}
            disabled={busy}
            onPress={() => setFilter("all")}
            style={[styles.chip, filter === "all" && styles.activeChip]}
          >
            <Text
              style={[
                styles.chipText,
                filter === "all" && styles.activeChipText,
              ]}
            >
              Todos · {mangas.length}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: filter === "reading" }}
            disabled={busy}
            onPress={() => setFilter("reading")}
            style={[styles.chip, filter === "reading" && styles.activeChip]}
          >
            <Text
              style={[
                styles.chipText,
                filter === "reading" && styles.activeChipText,
              ]}
            >
              Em leitura · {reading.length}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ordenar biblioteca. Ordem atual: ${sort === "recent" ? "último acesso" : "título"}`}
            disabled={busy}
            onPress={chooseSort}
            style={styles.sort}
          >
            <LibraryIcon name="sort" />
          </Pressable>
        </View>
        {busy && (
          <View style={styles.notice}>
            <ActivityIndicator size="small" color="#c5ef86" />
            <Text style={styles.noticeText}>
              {operation === "import"
                ? "Importando e validando suas páginas…"
                : "Removendo item…"}
            </Text>
          </View>
        )}
        {!!error && (
          <View style={styles.errorBox}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar mensagem de erro"
              onPress={() => setError("")}
              style={styles.clear}
            >
              <LibraryIcon name="close" color="#ffb4ab" />
            </Pressable>
          </View>
        )}
      </View>
      <FlatList
        ref={list}
        style={styles.list}
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={loading && books.length > 0}
        onRefresh={busy ? undefined : () => void refresh()}
        ListHeaderComponent={
          books.length > 0 ? (
            <View style={styles.listHeading}>
              <Text style={styles.listLabel}>
                {query.trim()
                  ? `${visible.length} ${visible.length === 1 ? "resultado" : "resultados"}`
                  : filter === "reading"
                    ? "SUAS LEITURAS"
                    : "NO SEU DISPOSITIVO"}
              </Text>
              <Text style={styles.order}>
                {sort === "recent" ? "Recentes" : "A–Z"}
              </Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => item.kind === "chapter" ? (
          <LibraryChapterRow book={item.book} last={item.last} disabled={busy}
            onOpen={() => open(item.book)} onOptions={() => options(item.book)} />
        ) : (
          <LibraryMangaCard
            manga={item.manga}
            expanded={expanded.has(item.manga.id)}
            featured={item.manga.id === featured}
            disabled={busy}
            onOpen={() => toggle(item.manga)}
            onOptions={() => mangaOptions(item.manga)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color="#c5ef86" />
              <Text style={styles.emptyCopy}>Abrindo sua biblioteca…</Text>
            </View>
          ) : books.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyArt}>
                <View style={styles.backBook} />
                <View style={styles.frontBook}>
                  <LibraryIcon name="book" color="#c5ef86" />
                </View>
              </View>
              <Text style={styles.emptyTitle}>
                {error
                  ? "Não foi possível carregar"
                  : "Sua próxima história começa aqui"}
              </Text>
              <Text style={styles.emptyCopy}>
                {error
                  ? "Tente abrir a biblioteca novamente."
                  : "Importe um CBZ do celular e leve sua leitura para qualquer lugar, mesmo sem internet."}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => (error ? void refresh() : void add())}
                style={({ pressed }) => [
                  styles.emptyAction,
                  pressed && styles.dim,
                ]}
              >
                <Text style={styles.emptyActionText}>
                  {error ? "Tentar novamente" : "Importar meu primeiro CBZ"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={explore}
                style={styles.exploreLink}
              >
                <Text style={styles.linkText}>
                  Explorar o catálogo MangaDex
                </Text>
                <LibraryIcon name="arrow" color="#c5ef86" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <LibraryIcon name="search" />
              <Text style={styles.emptyTitle}>Nenhum item encontrado</Text>
              <Text style={styles.emptyCopy}>
                Tente outro nome ou mude o filtro da biblioteca.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setQuery("");
                  setFilter("all");
                }}
                style={styles.exploreLink}
              >
                <Text style={styles.linkText}>Limpar busca e filtro</Text>
              </Pressable>
            </View>
          )
        }
        ListFooterComponent={
          visible.length > 0 ? (
            <Text style={styles.footerNote}>
              Armazenado no seu celular. Pronto para ler offline.
            </Text>
          ) : undefined
        }
      />
      <View
        style={[
          styles.navigation,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: true }}
          accessibilityLabel="Biblioteca"
          onPress={() => {
            Keyboard.dismiss();
            list.current?.scrollToOffset({ offset: 0, animated: true });
          }}
          style={styles.navItem}
        >
          <View style={styles.navIconActive}>
            <LibraryIcon name="book" color="#c5ef86" />
          </View>
          <Text style={styles.navActive}>Biblioteca</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: false }}
          accessibilityLabel="Explorar MangaDex"
          disabled={busy}
          onPress={explore}
          style={({ pressed }) => [styles.navItem, pressed && styles.dim]}
        >
          <View style={styles.navIcon}>
            <LibraryIcon name="compass" />
          </View>
          <Text style={styles.navText}>Explorar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0c131d" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 22,
  },
  brand: {
    fontSize: 10,
    letterSpacing: 2.5,
    fontWeight: "700",
    color: "#a1b18e",
    marginBottom: 8,
  },
  heading: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: "#f3f6fa",
  },
  subtitle: { fontSize: 13, lineHeight: 20, color: "#94a5bc", marginTop: 6 },
  importAction: { alignItems: "center", gap: 6, minWidth: 60 },
  importIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#c5ef86",
    alignItems: "center",
    justifyContent: "center",
  },
  importLabel: { color: "#d3dfc3", fontSize: 11, fontWeight: "600" },
  search: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    backgroundColor: "#131d2a",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#273448",
  },
  input: {
    flex: 1,
    color: "#f3f6fa",
    fontSize: 14,
    paddingVertical: 10,
    minWidth: 0,
  },
  clear: {
    minWidth: 44,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 13,
    justifyContent: "center",
    backgroundColor: "#131d2a",
    borderWidth: 1,
    borderColor: "#273448",
  },
  activeChip: { backgroundColor: "#253325", borderColor: "#536744" },
  chipText: { fontSize: 12, color: "#9faec1", fontWeight: "600" },
  activeChipText: { color: "#d7f3b2" },
  sort: {
    width: 44,
    minHeight: 44,
    marginLeft: "auto",
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    flexGrow: 1,
  },
  listHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    marginTop: 4,
    gap: 8,
  },
  listLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "700",
    color: "#8c9bb1",
    flexShrink: 1,
  },
  order: { fontSize: 11, color: "#8091a8" },
  notice: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    padding: 12,
    backgroundColor: "#202d24",
    borderRadius: 12,
    marginBottom: 12,
  },
  noticeText: { color: "#cfe3c3", fontSize: 12, flex: 1, lineHeight: 18 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#33222b",
    paddingLeft: 12,
    marginBottom: 12,
  },
  errorText: {
    color: "#ffb4ab",
    fontSize: 12,
    lineHeight: 19,
    flex: 1,
    paddingVertical: 10,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 14,
  },
  emptyArt: {
    width: 130,
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  backBook: {
    position: "absolute",
    width: 62,
    height: 88,
    borderRadius: 12,
    backgroundColor: "#273844",
    transform: [{ rotate: "-14deg" }, { translateX: -18 }],
  },
  frontBook: {
    width: 62,
    height: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#5f794e",
    backgroundColor: "#263b2d",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "9deg" }, { translateX: 12 }],
  },
  emptyTitle: {
    color: "#eff3f8",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 28,
    maxWidth: 280,
  },
  emptyCopy: {
    color: "#94a5bc",
    fontSize: 14,
    lineHeight: 23,
    textAlign: "center",
    maxWidth: 290,
  },
  emptyAction: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 13,
    backgroundColor: "#c5ef86",
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyActionText: {
    color: "#172414",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  exploreLink: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  linkText: { color: "#c5ef86", fontSize: 12, fontWeight: "600" },
  footerNote: {
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    color: "#75869d",
    paddingTop: 8,
    paddingBottom: 4,
  },
  navigation: {
    flexDirection: "row",
    backgroundColor: "#101a26",
    borderTopWidth: 1,
    borderTopColor: "#233043",
    paddingTop: 10,
    paddingHorizontal: 28,
  },
  navItem: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  navIcon: { paddingHorizontal: 18, paddingVertical: 3, borderRadius: 12 },
  navIconActive: {
    paddingHorizontal: 18,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: "#253325",
  },
  navText: { fontSize: 11, color: "#9faec1" },
  navActive: { fontSize: 11, color: "#c5ef86", fontWeight: "700" },
  dim: { opacity: 0.65 },
});
