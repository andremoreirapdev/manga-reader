import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { Suspense } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { migrate } from "../src/storage/database";
export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <Suspense
      fallback={
        <View>
          <ActivityIndicator />
          <Text>Abrindo biblioteca…</Text>
        </View>
      }
    >
      <SQLiteProvider
        databaseName="mangareader.db"
        onInit={migrate}
        useSuspense
      >
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#161c2b" },
            headerTintColor: "#fff",
            contentStyle: { backgroundColor: "#0b101b" },
          }}
        >
          <Stack.Screen name="index" options={{ title: "MangaReader" }} />
          <Stack.Screen name="reader/[id]" options={{ title: "Leitor" }} />
        </Stack>
      </SQLiteProvider>
    </Suspense>
  );
}
