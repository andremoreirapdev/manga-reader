import { useCallback, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { ActivityIndicator, Button, FlatList, Text, View } from "react-native";
import { mangaSource } from "../../src/providers/remote";
import { Cover } from "../../src/features/catalog/Cover";
import { styles } from "../../src/features/catalog/styles";
import { useDownloads } from "../../src/providers/downloads";
import { DownloadBanner } from "../../src/features/downloads/DownloadBanner";

const statusLabels: Record<string, string> = {
  ongoing: "Em publicação",
  completed: "Concluído",
  hiatus: "Em pausa",
  cancelled: "Cancelado",
};

export default function MangaDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { manager, snapshot } = useDownloads();

  useFocusEffect(
    useCallback(() => {
      void manager.refresh().catch(() => {});
    }, [manager]),
  );
  const [selectedLanguage, setSelectedLanguage] = useState<
    string | null | undefined
  >(undefined);
  const manga = useQuery({
    queryKey: [mangaSource.id, "manga", id],
    queryFn: ({ signal }) => mangaSource.getManga(id, signal),
  });
  const available = manga.data?.languages ?? [];
  const preferred = available.includes("pt-br")
    ? "pt-br"
    : available.includes("en")
      ? "en"
      : null;
  const language =
    selectedLanguage === undefined ? preferred : selectedLanguage;
  const chapters = useInfiniteQuery({
    queryKey: [mangaSource.id, "chapters", id, language],
    queryFn: ({ pageParam, signal }) =>
      mangaSource.chapters(id, language, { offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: !!manga.data,
  });
  const items = [
    ...new Map(
      chapters.data?.pages
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];

  if (manga.isPending) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
        <Text style={styles.muted}>Carregando título…</Text>
      </View>
    );
  }

  if (manga.isError) {
    return (
      <View style={styles.screen}>
        <Text accessibilityRole="alert" style={styles.error}>
          {manga.error.message}
        </Text>
        <Button title="Tentar novamente" onPress={() => void manga.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <DownloadBanner />
      <FlatList
        data={items}
        extraData={snapshot}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <View style={styles.row}>
              <Cover uri={manga.data.coverUrl} />
              <View style={{ flex: 1 }}>
                <Text style={styles.heading}>{manga.data.title}</Text>
                <Text style={styles.muted}>
                  {statusLabels[manga.data.status] ?? manga.data.status} ·{" "}
                  {manga.data.year ?? "Ano não informado"}
                </Text>
              </View>
            </View>
            <Text style={styles.muted}>Fonte: MangaDex</Text>
            <Text style={styles.text} numberOfLines={8}>
              {manga.data.description || "Sinopse não disponível."}
            </Text>
            <Text style={styles.heading}>Capítulos</Text>
            <Text style={styles.muted}>
              Idioma:{" "}
              {language === "pt-br"
                ? "Português brasileiro"
                : language === "en"
                  ? "Inglês"
                  : "Todos os idiomas"}
            </Text>
            <View style={styles.filters}>
              <Button
                title="PT-BR"
                disabled={language === "pt-br"}
                onPress={() => setSelectedLanguage("pt-br")}
              />
              <Button
                title="Inglês"
                disabled={language === "en"}
                onPress={() => setSelectedLanguage("en")}
              />
              <Button
                title="Todos"
                disabled={language === null}
                onPress={() => setSelectedLanguage(null)}
              />
            </View>
            <Text style={styles.muted}>
              Baixe um capítulo por vez para ler offline. Mantenha o app aberto
              até concluir.
            </Text>
            {chapters.isFetching && !chapters.isFetchingNextPage && (
              <ActivityIndicator />
            )}
            {chapters.error && (
              <View>
                <Text accessibilityRole="alert" style={styles.error}>
                  {chapters.error.message}
                </Text>
                <Button
                  title="Tentar novamente"
                  disabled={chapters.isFetching}
                  onPress={() =>
                    void (chapters.isFetchNextPageError
                      ? chapters.fetchNextPage()
                      : chapters.refetch())
                  }
                />
              </View>
            )}
            {chapters.data && (
              <Text style={styles.muted}>
                {items.length} de {chapters.data.pages[0].total} capítulos
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          chapters.isSuccess ? (
            <Text style={styles.muted}>
              Nenhum capítulo neste idioma. Experimente outro filtro.
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>
              {item.number ? `Capítulo ${item.number}` : "Capítulo sem número"}
              {item.title ? ` — ${item.title}` : ""}
            </Text>
            <Text style={styles.muted}>
              {item.volume ? `Volume ${item.volume} · ` : ""}
              {item.language} · {item.pages} páginas
            </Text>
            <Text style={styles.text}>
              {item.groups.length
                ? `Tradução: ${item.groups.join(", ")}`
                : "Grupo não informado"}
            </Text>
            {item.external && (
              <Text style={styles.muted}>Disponível em fonte externa.</Text>
            )}
            {snapshot.jobs[item.id]?.error && (
              <Text style={styles.error}>{snapshot.jobs[item.id].error}</Text>
            )}
            <Button
              title={
                snapshot.jobs[item.id]?.status === "completed"
                  ? "Ler offline"
                  : snapshot.active?.chapterId === item.id
                    ? "Baixando…"
                    : snapshot.jobs[item.id]
                      ? "Tentar download novamente"
                      : "Baixar capítulo"
              }
              disabled={
                snapshot.jobs[item.id]?.status === "completed"
                  ? false
                  : !snapshot.ready ||
                    !!snapshot.active ||
                    item.external ||
                    item.pages === 0
              }
              onPress={() => {
                const saved = snapshot.jobs[item.id];

                if (saved?.status === "completed") {
                  router.push({
                    pathname: "/reader/[id]",
                    params: { id: saved.bookId },
                  });
                } else {
                  void manager.start({ manga: manga.data, chapter: item });
                }
              }}
            />
          </View>
        )}
        ListFooterComponent={
          chapters.hasNextPage ? (
            <Button
              title={
                chapters.isFetchingNextPage
                  ? "Carregando…"
                  : "Carregar mais capítulos"
              }
              disabled={chapters.isFetching}
              onPress={() => void chapters.fetchNextPage()}
            />
          ) : undefined
        }
      />
    </View>
  );
}
