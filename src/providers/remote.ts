import { QueryClient } from "@tanstack/react-query";
import { createMangaDexSource } from "../services/mangadex/source";

export const mangaSource = createMangaDexSource();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
