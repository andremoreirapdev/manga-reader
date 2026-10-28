import { Pressable, StyleSheet, Text } from "react-native";

export function ReaderButton({ label, onPress, disabled = false, selected = false, accessibilityLabel }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        (pressed || disabled) && styles.dim,
      ]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#131d2a",
    borderWidth: 1,
    borderColor: "#29384a",
    justifyContent: "center",
    alignItems: "center",
  },
  selected: { backgroundColor: "#c5ef86", borderColor: "#c5ef86" },
  label: { color: "#dce5ef", fontSize: 13, fontWeight: "600" },
  selectedLabel: { color: "#172414" },
  dim: { opacity: 0.4 },
});
