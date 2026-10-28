import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { USER_AGENT } from "../../services/mangadex/source";
import { styles } from "./styles";

export function Cover({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (!uri || failed) {
    return (
      <View style={[styles.cover, { justifyContent: "center" }]}>
        <Text style={[styles.muted, { textAlign: "center" }]}>Sem capa</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri, headers: { "User-Agent": USER_AGENT } }}
      style={styles.cover}
      contentFit="cover"
      cachePolicy="disk"
      onError={() => setFailed(true)}
      accessibilityLabel="Capa do título"
    />
  );
}
