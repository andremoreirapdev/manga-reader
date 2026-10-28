import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { Suspense } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { migrate } from "../src/storage/database";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../src/providers/remote";

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
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
            <Stack.Screen
              name="catalog/index"
              options={{ title: "Catálogo online" }}
            />
            <Stack.Screen
              name="catalog/[id]"
              options={{ title: "Detalhes e capítulos" }}
            />
          </Stack>
        </SQLiteProvider>
      </Suspense>
    </QueryClientProvider>
  );
}
