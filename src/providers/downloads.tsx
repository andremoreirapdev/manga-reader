import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { mangaSource } from "./remote";
import {
  createDownloadManager,
  type DownloadManager,
} from "../services/downloads/manager";

const Context = createContext<DownloadManager | null>(null);

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [manager] = useState(() => createDownloadManager(db, mangaSource));

  useEffect(() => {
    void manager.initialize().catch(() => {});
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "background") manager.cancel("interrupted");
    });

    return () => {
      listener.remove();
      manager.cancel("interrupted");
    };
  }, [manager]);

  return <Context.Provider value={manager}>{children}</Context.Provider>;
}

export function useDownloads() {
  const manager = useContext(Context);

  if (!manager) throw new Error("DownloadsProvider não foi inicializado.");

  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);

  return { manager, snapshot };
}
