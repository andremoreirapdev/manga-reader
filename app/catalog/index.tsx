import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Button,
  FlatList,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { mangaSource } from "../../src/providers/remote";
import { Cover } from "../../src/features/catalog/Cover";
import { styles } from "../../src/features/catalog/styles";

export default function Catalog() {
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const query = useInfiniteQuery({
    queryKey: [mangaSource.id, "search", title],
    queryFn: ({ pageParam, signal }) =>
      mangaSource.search(title, { offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: title.length >= 2,
  });
  const items = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]),
    ).values(),
  ];

  function search() {
    Keyboard.dismiss();
    const next = input.trim();

    if (next.length >= 2) {
      setTitle(next);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Catálogo MangaDex</Text>
      <Text style={styles.muted}>Fonte: MangaDex · consulta online</Text>
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="Nome do mangá"
        placeholderTextColor="#aab7cc"
        accessibilityLabel="Nome do mangá para pesquisar"
        autoCorrect={false}
        maxLength={150}
        returnKeyType="search"
        onSubmitEditing={search}
      />
      <Button
        title="Buscar"
        onPress={search}
        disabled={input.trim().length < 2}
      />
      {query.isFetching && !query.isFetchingNextPage && <ActivityIndicator />}
      {query.error && (
        <View>
          <Text accessibilityRole="alert" style={styles.error}>
            {query.error.message}
          </Text>
          <Button
            title="Tentar novamente"
            disabled={query.isFetching}
            onPress={() =>
              void (query.isFetchNextPageError
                ? query.fetchNextPage()
                : query.refetch())
            }
          />
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          query.data ? (
            <Text style={styles.muted}>
              {items.length} de {query.data.pages[0].total} resultados
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <Text style={styles.muted}>
            {!title
              ? "Digite pelo menos dois caracteres para buscar."
              : query.isSuccess
                ? "Nenhum título encontrado."
                : ""}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={[styles.card, styles.row]}
            onPress={() =>
              router.push({
                pathname: "/catalog/[id]",
                params: { id: item.id },
              })
            }
          >
            <Cover uri={item.coverUrl} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.muted}>
                {item.year ?? "Ano não informado"}
              </Text>
              <Text style={styles.text}>Ver detalhes e capítulos</Text>
            </View>
          </Pressable>
        )}
        ListFooterComponent={
          query.hasNextPage ? (
            <Button
              title={query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              disabled={query.isFetching}
              onPress={() => void query.fetchNextPage()}
            />
          ) : undefined
        }
      />
    </View>
  );
}
