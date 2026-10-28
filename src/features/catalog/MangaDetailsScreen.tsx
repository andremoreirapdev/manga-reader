import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Stack, useFocusEffect, useLocalSearchParams, router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { Book } from "../../storage/database";
import type { Manga } from "../../types/manga-source";
import { mangaSource } from "../../providers/remote";
import { loadLocalManga } from "../../services/manga-library";
import { removeBook } from "../../services/library";
import { useDownloads } from "../../providers/downloads";
import { DownloadBanner } from "../downloads/DownloadBanner";
import { LibraryActionSheet } from "../library/LibraryActionSheet";
import { groupBooks } from "../library/grouping";
import { readingPosition } from "../library/selectors";
import { Cover } from "./Cover";
import { buildChapterRows, type ChapterFilter } from "./chapter-list";

const statusLabels: Record<string, string> = {
  ongoing: "Em publicação", completed: "Concluído", hiatus: "Em pausa", cancelled: "Cancelado",
};

function Action({ title, onPress, disabled = false, secondary = false }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.action, secondary && styles.secondary, (pressed || disabled) && styles.dim]}>
      <Text style={[styles.actionText, secondary && styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

export function MangaDetailsScreen() {
  const params = useLocalSearchParams<{ id: string; from?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { manager, snapshot } = useDownloads();
  const [filter, setFilter] = useState<ChapterFilter>(params.from === "library" ? "downloaded" : "all");
  const [selectedLanguage, setSelectedLanguage] = useState<string | null | undefined>(undefined);
  const [remembered, setRemembered] = useState<Manga | null>(null);
  const [remove, setRemove] = useState<Book | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [expandedDescription, setExpandedDescription] = useState(false);
  const local = useQuery({
    queryKey: [mangaSource.id, "local-manga", id],
    queryFn: () => loadLocalManga(db, mangaSource.id, id),
    enabled: !!id, networkMode: "always", staleTime: 0, refetchOnMount: "always",
  });
  const remote = useQuery({
    queryKey: [mangaSource.id, "manga", id],
    queryFn: ({ signal }) => mangaSource.getManga(id, signal), enabled: !!id,
  });
  const candidate = remote.data ?? local.data?.manga;
  const manga = candidate ?? (remembered?.id === id ? remembered : null);
  const books = local.data?.books ?? [];
  const group = useMemo(() => groupBooks(books)[0], [local.data]);
  const available = manga?.languages ?? [];
  const preferred = available.includes("pt-br") ? "pt-br" : available.includes("en") ? "en" : null;
  const language = selectedLanguage === undefined ? filter === "downloaded" ? null : preferred : selectedLanguage;
  const chapters = useInfiniteQuery({
    queryKey: [mangaSource.id, "chapters", id, language],
    queryFn: ({ pageParam, signal }) => mangaSource.chapters(id, language, { offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: !!id && !!manga && local.isSuccess && filter !== "downloaded",
  });
  const remoteItems = useMemo(() => chapters.data?.pages.flatMap((page) => page.items) ?? [], [chapters.data]);
  const rows = useMemo(() => buildChapterRows({
    chapters: remoteItems, books, sourceId: mangaSource.id, mangaId: id, language, filter,
  }), [remoteItems, local.data, id, language, filter]);
  const completed = Object.values(snapshot.jobs).filter((job) => job.status === "completed").length;

  useEffect(() => {
    setFilter(params.from === "library" ? "downloaded" : "all");
    setSelectedLanguage(undefined);
    setRemembered(null);
    setRemove(null);
    setError("");
    setExpandedDescription(false);
  }, [id, params.from]);

  useEffect(() => {
    if (candidate) setRemembered(candidate);
  }, [candidate]);

  useEffect(() => {
    if (id) void local.refetch();
  }, [completed, id, local.refetch]);

  useFocusEffect(useCallback(() => {
    void manager.refresh().catch(() => {});
    void local.refetch();
  }, [manager, local.refetch]));

  function read(book: Book) {
    router.push({ pathname: "/reader/[id]", params: { id: book.id } });
  }

  async function deleteChapter(book: Book) {
    setRemove(null);
    setRemoving(true);
    setError("");

    try {
      await removeBook(db, book.id);
      await local.refetch({ throwOnError: true });
      await manager.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(false);
    }
  }

  if (!id) return <View style={styles.screen}><Text style={styles.error}>Mangá não informado.</Text></View>;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Detalhes do mangá" }} />
      <LibraryActionSheet visible={remove !== null} title="Remover capítulo?"
        description={remove ? `Remover “${remove.title}” do dispositivo? Os outros capítulos serão preservados.` : ""}
        actions={remove ? [{ label: "Remover capítulo", description: "Apaga os arquivos deste capítulo e seu progresso local.", destructive: true, onPress: () => void deleteChapter(remove) }] : []}
        onClose={() => setRemove(null)} />
      <FlatList data={rows} extraData={snapshot} keyExtractor={(row) => row.id}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
        ListHeaderComponent={
          <View style={styles.header}>
            <DownloadBanner />
            <View style={styles.heading}>
              <Cover large uri={local.data?.cover ?? manga?.coverUrl ?? null} />
              <View style={styles.headingText}>
                <Text style={styles.eyebrow}>MANGADEX</Text>
                <Text style={styles.title}>{manga?.title ?? (remote.isError ? "Detalhes indisponíveis" : "Carregando mangá…")}</Text>
                <Text style={styles.muted}>
                  {manga?.status ? statusLabels[manga.status] ?? manga.status : "Sua coleção"}
                  {manga?.year ? ` · ${manga.year}` : ""}
                </Text>
                <Text style={styles.accent}>{books.length} {books.length === 1 ? "capítulo baixado" : "capítulos baixados"}</Text>
              </View>
            </View>
            {manga?.description ? (
              <View style={{ gap: 6 }}>
                <Text style={styles.description} numberOfLines={expandedDescription ? undefined : 5}>{manga.description}</Text>
                <Pressable accessibilityRole="button" onPress={() => setExpandedDescription(!expandedDescription)} style={styles.link}>
                  <Text style={styles.accent}>{expandedDescription ? "Recolher sinopse" : "Ler sinopse completa"}</Text>
                </Pressable>
              </View>
            ) : <Text style={styles.muted}>{manga ? "Sinopse não disponível." : remote.isError ? "Não foi possível carregar as informações da fonte." : "Carregando informações…"}</Text>}
            {group && (
              <Action title={`${group.resume.page > 0 ? "Continuar" : "Ler"} · Cap. ${group.resume.chapterNumber ?? "especial"} · pág. ${readingPosition(group.resume).page}`}
                disabled={removing} onPress={() => read(group.resume)} />
            )}
            {remote.isError && (
              <View style={styles.notice}>
                <Text style={styles.muted}>{remote.error.message}{books.length > 0 ? " Os capítulos baixados continuam disponíveis." : ""}</Text>
                <Action secondary title="Atualizar dados da fonte" disabled={remote.isFetching} onPress={() => void remote.refetch()} />
              </View>
            )}
            {local.error && (
              <View style={styles.notice}>
                <Text accessibilityRole="alert" style={styles.error}>{local.error.message}</Text>
                <Action secondary title="Recarregar biblioteca" onPress={() => void local.refetch()} />
              </View>
            )}
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <Text style={styles.sectionTitle}>Capítulos</Text>
            <View style={styles.filters}>
              {([['all', 'Todos'], ['downloaded', `Baixados · ${books.length}`], ['available', 'Para baixar']] as const).map(([value, label]) => (
                <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }}
                  onPress={() => setFilter(value)} style={[styles.chip, filter === value && styles.selected]}>
                  <Text style={[styles.chipText, filter === value && styles.selectedText]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.muted}>Idioma: {language === "pt-br" ? "Português brasileiro" : language === "en" ? "Inglês" : "Todos"}</Text>
            <View style={styles.filters}>
              {([['pt-br', 'PT-BR'], ['en', 'Inglês'], [null, 'Todos']] as const).map(([value, label]) => (
                <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: language === value }}
                  onPress={() => setSelectedLanguage(value)} style={[styles.language, language === value && styles.selected]}>
                  <Text style={[styles.chipText, language === value && styles.selectedText]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {filter !== "downloaded" && chapters.isFetching && <ActivityIndicator color="#c5ef86" />}
            {filter !== "downloaded" && chapters.error && (
              <View style={styles.notice}>
                <Text accessibilityRole="alert" style={styles.error}>{chapters.error.message}</Text>
                <Action secondary title="Tentar carregar capítulos novamente" disabled={chapters.isFetching}
                  onPress={() => void (chapters.isFetchNextPageError ? chapters.fetchNextPage() : chapters.refetch())} />
              </View>
            )}
            <Text style={styles.muted}>
              {rows.length} {rows.length === 1 ? "resultado exibido" : "resultados exibidos"}
              {filter !== "downloaded" && chapters.data ? ` · ${new Set(remoteItems.map((chapter) => chapter.id)).size} de ${chapters.data.pages[0].total} capítulos carregados da fonte` : ""}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const saved = item.local;
          const chapter = item.remote;
          const job = snapshot.jobs[item.id];
          const active = snapshot.active?.chapterId === item.id;
          const unavailable = !chapter || chapter.external || chapter.pages === 0;
          const number = saved?.chapterNumber ?? chapter?.number;
          const canDownload = !!manga && local.isSuccess && snapshot.ready && !snapshot.active && !removing && !unavailable;

          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={[styles.badge, saved && styles.downloaded]}>{saved ? "BAIXADO" : active ? "BAIXANDO" : unavailable ? "INDISPONÍVEL" : "DISPONÍVEL"}</Text>
                {saved && <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${saved.title}`}
                  disabled={removing} onPress={() => setRemove(saved)} style={styles.link}><Text style={styles.muted}>Remover</Text></Pressable>}
              </View>
              <Text style={styles.chapterTitle}>Capítulo {number ?? "especial"}{chapter?.title ? ` — ${chapter.title}` : ""}</Text>
              <Text style={styles.muted}>
                {chapter?.volume ? `Volume ${chapter.volume} · ` : ""}
                {saved?.chapterLanguage ?? chapter?.language ?? "Idioma não informado"} · {saved?.pages ?? chapter?.pages ?? 0} páginas
              </Text>
              <Text style={styles.credits}>{saved?.credits ?? (chapter?.groups.length ? `Tradução: ${chapter.groups.join(", ")}` : "Grupo não informado")}</Text>
              {saved && <Text style={styles.accent}>Página {readingPosition(saved).page} de {saved.pages} · {readingPosition(saved).percent}%</Text>}
              {!saved && job?.error && <Text style={styles.error}>{job.error}</Text>}
              <Action title={saved ? "Ler offline" : active ? "Baixando…" : unavailable ? "Download indisponível" : job && job.status !== "completed" ? "Tentar download novamente" : "Baixar capítulo"}
                disabled={saved ? removing : !canDownload} onPress={() => {
                  if (saved) read(saved);
                  else if (manga && chapter && canDownload) void manager.start({ manga, chapter });
                }} />
            </View>
          );
        }}
        ListEmptyComponent={local.isPending || (!manga && remote.isPending) ? <ActivityIndicator color="#c5ef86" />
          : local.isError || (!manga && remote.isError) || (filter !== "downloaded" && (chapters.error || chapters.isFetching)) ? undefined
            : <Text style={styles.empty}>{filter === "downloaded" ? "Nenhum capítulo baixado neste idioma. Consulte Todos ou Para baixar." : filter === "available" ? "Nenhum capítulo para baixar nos resultados carregados. Experimente outro idioma ou carregue mais capítulos." : "Nenhum capítulo encontrado neste idioma."}</Text>}
        ListFooterComponent={filter !== "downloaded" && chapters.hasNextPage ? (
          <View style={{ marginTop: 12 }}><Action secondary title={chapters.isFetchingNextPage ? "Carregando…" : "Carregar mais capítulos"}
            disabled={chapters.isFetching} onPress={() => void chapters.fetchNextPage()} /></View>
        ) : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b121c" },
  content: { padding: 18 },
  header: { gap: 14, paddingBottom: 12 },
  heading: { flexDirection: "row", gap: 16, alignItems: "center" },
  headingText: { flex: 1, gap: 8 },
  eyebrow: { color: "#a8bd8e", fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  title: { color: "#f3f6fa", fontSize: 23, lineHeight: 29, fontWeight: "700" },
  muted: { color: "#9faec1", fontSize: 12, lineHeight: 19 },
  accent: { color: "#c5ef86", fontSize: 12, lineHeight: 19 },
  description: { color: "#c6d1df", fontSize: 14, lineHeight: 23 },
  sectionTitle: { color: "#f3f6fa", fontSize: 20, fontWeight: "700", marginTop: 8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderWidth: 1, borderColor: "#29384a", borderRadius: 12 },
  language: { minHeight: 40, paddingHorizontal: 12, justifyContent: "center", borderWidth: 1, borderColor: "#29384a", borderRadius: 9 },
  selected: { backgroundColor: "#293a25", borderColor: "#79994e" },
  chipText: { color: "#aab7c9", fontSize: 12, fontWeight: "600" },
  selectedText: { color: "#d7f3b2" },
  action: { minHeight: 46, padding: 12, borderRadius: 11, backgroundColor: "#c5ef86", alignItems: "center", justifyContent: "center" },
  actionText: { color: "#172414", fontSize: 13, fontWeight: "700", textAlign: "center" },
  secondary: { borderWidth: 1, borderColor: "#435b34", backgroundColor: "#1a2822" },
  secondaryText: { color: "#c5ef86" },
  dim: { opacity: 0.5 },
  notice: { padding: 12, gap: 8, borderRadius: 12, backgroundColor: "#16202d" },
  error: { color: "#ffb4ab", fontSize: 12, lineHeight: 20 },
  card: { backgroundColor: "#131d2a", borderWidth: 1, borderColor: "#29384a", borderRadius: 15, padding: 14, gap: 9, marginBottom: 12 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  badge: { color: "#9faec1", fontSize: 9, letterSpacing: 1, fontWeight: "700" },
  downloaded: { color: "#c5ef86" },
  chapterTitle: { color: "#f3f6fa", fontSize: 16, lineHeight: 23, fontWeight: "600" },
  credits: { color: "#aab7c9", fontSize: 11, lineHeight: 17 },
  link: { minHeight: 40, justifyContent: "center" },
  empty: { color: "#9faec1", fontSize: 13, lineHeight: 22, paddingVertical: 20 },
});
