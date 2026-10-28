import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { clamp, focalOffset, panLimit, swipePage } from "./gestures";
import { ReaderButton } from "./ReaderButton";

export function ZoomablePage({ uri, page, onMove, onError }: {
  uri: string;
  page: number;
  onMove?: (delta: number) => void;
  onError: () => void;
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState({ width: 0, height: 0 });

  return (
    <View style={styles.root}>
      <View
        style={styles.viewport}
        onLayout={({ nativeEvent: { layout } }) =>
          setViewport({ width: layout.width, height: layout.height })
        }
      >
        {/* A mudança de orientação também restaura uma posição válida. */}
        {viewport.width > 0 && viewport.height > 0 && (
          <PageSurface
            key={`${uri}-${viewport.width}-${viewport.height}`}
            uri={uri}
            page={page}
            width={viewport.width}
            height={viewport.height}
            imageWidth={image.width}
            imageHeight={image.height}
            onSize={setImage}
            onMove={onMove}
            onError={onError}
          />
        )}
      </View>
    </View>
  );
}

function PageSurface({ uri, page, width, height, imageWidth, imageHeight, onSize, onMove, onError }: {
  uri: string;
  page: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  onSize: (size: { width: number; height: number }) => void;
  onMove?: (delta: number) => void;
  onError: () => void;
}) {
  // Reserva espaço para os controles sem sobrepor a imagem.
  const viewHeight = Math.max(1, height - 54);
  const pictureHeight = imageWidth > 0 ? width * imageHeight / imageWidth : viewHeight;
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const pinching = useSharedValue(false);
  const multiple = useSharedValue(false);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const [percent, setPercent] = useState(100);
  const [ready, setReady] = useState(false);

  function reset() {
    scale.value = 1;
    x.value = 0;
    y.value = panLimit(pictureHeight, viewHeight, 1);
    setPercent(100);
  }

  function zoom(delta: number) {
    const next = clamp(scale.value + delta, 1, 4);
    const ratio = next / scale.value;
    x.value = clamp(x.value * ratio, -panLimit(width, width, next), panLimit(width, width, next));
    y.value = clamp(y.value * ratio, -panLimit(pictureHeight, viewHeight, next), panLimit(pictureHeight, viewHeight, next));
    scale.value = next;
    setPercent(Math.round(next * 100));
  }

  const pinch = usePinchGesture({
    enabled: ready,
    onActivate: (event) => {
      "worklet";

      pinching.value = true;
      multiple.value = true;
      startScale.value = scale.value;
      startX.value = x.value;
      startY.value = y.value;
      focalX.value = event.focalX - width / 2;
      focalY.value = event.focalY - viewHeight / 2;
    },
    onUpdate: (event) => {
      "worklet";

      const next = clamp(startScale.value * event.scale, 1, 4);
      const ratio = next / startScale.value;
      const limitX = panLimit(width, width, next);
      const limitY = panLimit(pictureHeight, viewHeight, next);
      x.value = clamp(
        focalOffset(focalX.value, startX.value, ratio) + event.focalX - width / 2 - focalX.value,
        -limitX,
        limitX,
      );
      y.value = clamp(
        focalOffset(focalY.value, startY.value, ratio) + event.focalY - viewHeight / 2 - focalY.value,
        -limitY,
        limitY,
      );
      scale.value = next;
    },
    onFinalize: () => {
      "worklet";

      pinching.value = false;
      scheduleOnRN(setPercent, Math.round(scale.value * 100));
    },
  });

  const pan = usePanGesture({
    enabled: ready,
    minDistance: 10,
    averageTouches: true,
    onBegin: () => {
      "worklet";

      multiple.value = false;
    },
    onUpdate: (event) => {
      "worklet";

      if (event.numberOfPointers > 1) {
        multiple.value = true;
      }

      if (pinching.value || multiple.value) return;

      const limitX = panLimit(width, width, scale.value);
      const limitY = panLimit(pictureHeight, viewHeight, scale.value);
      x.value = clamp(x.value + event.changeX, -limitX, limitX);
      y.value = clamp(y.value + event.changeY, -limitY, limitY);
    },
    onDeactivate: (event) => {
      "worklet";

      const delta = swipePage(event.translationX, event.translationY, scale.value, multiple.value);

      if (!event.canceled && delta && onMove) {
        scheduleOnRN(onMove, delta);
      }
    },
  });

  const gestures = useSimultaneousGestures(pan, pinch);
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  const magnify = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={styles.root}>
      <View style={{ height: viewHeight, overflow: "hidden" }}>
        <GestureDetector gesture={gestures}>
          <Animated.View style={[{ width, height: viewHeight }, transform]}>
            <Animated.View style={[{ position: "absolute", width, height: pictureHeight, top: (viewHeight - pictureHeight) / 2 }, magnify]}>
              <Image
                source={uri}
                style={styles.image}
                contentFit="contain"
                cachePolicy="none"
                allowDownscaling={false}
                accessibilityLabel={`Página ${page + 1}. Use pinça para ampliar e arraste para movimentar.`}
                onLoad={({ source }) => {
                  if (source.width <= 0 || source.height <= 0) {
                    onError();
                    return;
                  }

                  onSize({ width: source.width, height: source.height });
                  y.value = panLimit(width * source.height / source.width, viewHeight, 1);
                  setReady(true);
                }}
                onError={onError}
              />
            </Animated.View>
          </Animated.View>
        </GestureDetector>
        {!ready && <ActivityIndicator color="#c5ef86" style={StyleSheet.absoluteFill} />}
      </View>
      <View style={styles.tools}>
        <ReaderButton label="−" accessibilityLabel="Diminuir zoom" onPress={() => zoom(-0.5)} disabled={!ready || percent <= 100} />
        <Text style={styles.percent} accessibilityLiveRegion="polite">{percent}%</Text>
        <ReaderButton label="+" accessibilityLabel="Aumentar zoom" onPress={() => zoom(0.5)} disabled={!ready || percent >= 400} />
        <ReaderButton label="Restaurar" onPress={reset} disabled={!ready} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  viewport: { flex: 1, backgroundColor: "#080d14" },
  image: { width: "100%", height: "100%" },
  tools: {
    height: 54,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0d1521",
  },
  percent: { color: "#c5ef86", fontSize: 12, width: 44, textAlign: "center", fontVariant: ["tabular-nums"] },
});
