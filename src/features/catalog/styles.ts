import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  heading: { color: "#fff", fontSize: 22, fontWeight: "700" },
  title: { color: "#fff", fontSize: 17, fontWeight: "600" },
  text: { color: "#d6dfed", lineHeight: 22 },
  muted: { color: "#aab7cc", marginVertical: 6 },
  error: { color: "#ffb4ab", marginVertical: 8 },
  input: {
    backgroundColor: "#161c2b",
    color: "#fff",
    borderColor: "#52627b",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  card: {
    backgroundColor: "#161c2b",
    padding: 12,
    marginVertical: 6,
    borderRadius: 10,
    gap: 6,
  },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  filters: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    marginVertical: 8,
  },
  cover: {
    width: 72,
    height: 104,
    borderRadius: 6,
    backgroundColor: "#25314a",
  },
});
