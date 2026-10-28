import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Button, FlatList, Text, View } from "react-native";
import { Image } from "expo-image";
import {
  createVerticalSession,
  verticalPageSizes,
} from "../../services/library";
import { pageLayouts, type PageSize } from "./layout";

type Session = ReturnType<typeof createVerticalSession>;

const Page = memo(function Page({
  page,
  height,
  session,
}: {
  page: number;
  height: number;
  session: Session;
}) {
  const [uri, setUri] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setUri("");
    setError("");
    const resource = session.retain(page);
    resource.uri
      .then((uri) => {
        if (active) setUri(uri);
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      resource.release();
    };
  }, [session, page, retry]);

  return (
    <View style={{ height, width: "100%", justifyContent: "center" }}>
      {uri && !error ? (
        <Image
          source={uri}
          style={{ width: "100%", height: "100%" }}
          contentFit="contain"
          cachePolicy="none"
          recyclingKey={String(page)}
          accessibilityLabel={`Página ${page + 1}`}
          onError={() => setError("Não foi possível decodificar esta imagem.")}
        />
      ) : error ? (
        <View>
          <Text style={{ color: "#ffb4ab", textAlign: "center" }}>
            Página {page + 1}: {error}
          </Text>
          <Button
            title="Tentar novamente"
            onPress={() => setRetry((n) => n + 1)}
          />
        </View>
      ) : (
        <ActivityIndicator
          accessibilityLabel={`Carregando página ${page + 1}`}
        />
      )}
    </View>
  );
});

export function VerticalReader({
  id,
  initialPage,
  count,
  width,
  onPage,
}: {
  id: string;
  initialPage: number;
  count: number;
  width: number;
  onPage: (page: number) => void;
}) {
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const callback = useRef(onPage);
  callback.current = onPage;
  const start = useRef(initialPage);

  useEffect(() => {
    let active = true;
    const next = createVerticalSession(id);
    setSession(next);
    setSizes(null);
    setError("");
    verticalPageSizes(id, () => !active)
      .then((sizes) => {
        if (active) {
          if (sizes.length !== count)
            throw new Error(
              "A contagem de páginas não corresponde ao arquivo.",
            );
          setSizes(sizes);
        }
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
      next.close();
    };
  }, [id, count, retry]);

  const layouts = useMemo(
    () => pageLayouts(sizes ?? [], width),
    [sizes, width],
  );

  const data = useMemo(
    () => Array.from({ length: count }, (_, i) => i),
    [count],
  );

  const viewability = useRef({
    viewAreaCoveragePercentThreshold: 10,
    minimumViewTime: 150,
  }).current;

  const changed = useRef(
    ({ viewableItems }: {
      viewableItems: { item: number; isViewable: boolean }[];
    }) => {
      const first = viewableItems.find((item) => item.isViewable);
      if (first) {
        start.current = first.item;
        callback.current(first.item);
      }
    },
  ).current;

  if (error)
    return (
      <View>
        <Text style={{ color: "#ffb4ab" }}>{error}</Text>
        <Button
          title="Tentar novamente"
          onPress={() => setRetry((n) => n + 1)}
        />
      </View>
    );

  if (!sizes || !session)
    return (
      <View>
        <ActivityIndicator />
        <Text style={{ color: "#fff", textAlign: "center" }}>
          Preparando leitura vertical…
        </Text>
      </View>
    );
    
  return (
    <FlatList
      key={width}
      style={{ flex: 1 }}
      data={data}
      keyExtractor={(page) => String(page)}
      renderItem={({ item }) => (
        <Page page={item} height={layouts[item].length} session={session} />
      )}
      getItemLayout={(_, index) => layouts[index]}
      initialScrollIndex={start.current}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={5}
      removeClippedSubviews
      viewabilityConfig={viewability}
      onViewableItemsChanged={changed}
      ListFooterComponent={
        <Text style={{ color: "#aab7cc", textAlign: "center", padding: 16 }}>
          Fim do capítulo
        </Text>
      }
    />
  );
}
