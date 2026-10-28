import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReaderButton } from "./ReaderButton";
import { ZoomablePage } from "./ZoomablePage";
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
  onZoom,
}: {
  page: number;
  height: number;
  session: Session;
  onZoom: (page: number) => void;
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
        <>
          <Pressable
            style={{ width: "100%", height: "100%" }}
            onLongPress={() => onZoom(page)}
            accessibilityRole="button"
            accessibilityLabel={`Ampliar página ${page + 1}`}
            accessibilityHint="Mantenha pressionado para abrir o zoom. Também há um botão Ampliar."
            accessibilityActions={[{ name: "activate", label: "Ampliar página" }]}
            onAccessibilityAction={() => onZoom(page)}
          >
            <Image
              source={uri}
              style={{ width: "100%", height: "100%" }}
              contentFit="contain"
              cachePolicy="none"
              recyclingKey={String(page)}
              accessibilityLabel={`Página ${page + 1}`}
              onError={() => setError("Não foi possível decodificar esta imagem.")}
            />
          </Pressable>
          <View style={{ position: "absolute", right: 10, top: 10 }}>
            <ReaderButton label={`Ampliar · ${page + 1}`} onPress={() => onZoom(page)} />
          </View>
        </>
      ) : error ? (
        <View>
          <Text style={{ color: "#ffb4ab", textAlign: "center" }}>
            Página {page + 1}: {error}
          </Text>
          <ReaderButton
            label="Tentar novamente"
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
  const [zoomPage, setZoomPage] = useState<number | null>(null);
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
        <ReaderButton
          label="Tentar novamente"
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
    <>
      <FlatList
        key={width}
        style={{ flex: 1 }}
        data={data}
        keyExtractor={(page) => String(page)}
        renderItem={({ item }) => (
          <Page page={item} height={layouts[item].length} session={session} onZoom={setZoomPage} />
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
      {zoomPage !== null && <ExpandedPage page={zoomPage} session={session} onClose={() => setZoomPage(null)} />}
    </>
  );
}

function ExpandedPage({ page, session, onClose }: { page: number; session: Session; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // A referência própria mantém o arquivo vivo mesmo se a lista reciclar a célula.
    const resource = session.retain(page);
    resource.uri.then((value) => {
      if (active) setUri(value);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      active = false;
      resource.release();
    };
  }, [page, session]);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0d1521", paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 }}>
          <Text style={{ color: "#f1f5f9", fontSize: 16, fontWeight: "700" }}>Página {page + 1}</Text>
          <ReaderButton label="Fechar ampliação" onPress={onClose} />
        </View>
        <Text style={{ color: "#9faec1", textAlign: "center", paddingBottom: 12 }}>Use pinça para ampliar e arraste para explorar</Text>
        {!!error ? <Text style={{ color: "#ffb4ab", padding: 16 }}>{error}</Text> : uri ? (
          <ZoomablePage uri={uri} page={page} onError={() => setError("Não foi possível decodificar esta imagem.")} />
        ) : <ActivityIndicator color="#c5ef86" />}
      </GestureHandlerRootView>
    </Modal>
  );
}
