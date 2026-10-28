import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LibraryIcon } from "./LibraryIcon";

export type SheetAction = {
  label: string;
  description: string;
  onPress: () => void;
  destructive?: boolean;
  selected?: boolean;
};

export function LibraryActionSheet({
  visible,
  title,
  description,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  description: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar menu"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          <View style={styles.handle} />
          <View style={styles.heading}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <Text style={styles.description}>{description}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar menu"
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <LibraryIcon name="close" />
            </Pressable>
          </View>
          <ScrollView bounces={false} contentContainerStyle={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole={
                  action.selected === undefined ? "button" : "radio"
                }
                accessibilityState={
                  action.selected === undefined
                    ? undefined
                    : { checked: action.selected }
                }
                onPress={action.onPress}
                style={({ pressed }) => [
                  styles.action,
                  action.selected && styles.selectedAction,
                  action.destructive && styles.dangerAction,
                  pressed && styles.pressed,
                ]}
              >
                <View style={{ flex: 1, gap: 5 }}>
                  <Text
                    style={[
                      styles.actionTitle,
                      action.selected && styles.selectedText,
                      action.destructive && styles.dangerText,
                    ]}
                  >
                    {action.label}
                  </Text>
                  <Text
                    style={[
                      styles.actionDescription,
                      action.destructive && styles.dangerDescription,
                    ]}
                  >
                    {action.description}
                  </Text>
                </View>
                {action.selected !== undefined ? (
                  <View
                    style={[
                      styles.radio,
                      action.selected && styles.radioSelected,
                    ]}
                  >
                    {action.selected && <View style={styles.radioDot} />}
                  </View>
                ) : (
                  <LibraryIcon
                    name="arrow"
                    color={action.destructive ? "#ffb4ab" : "#9faec1"}
                  />
                )}
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "flex-end",
  },
  panel: {
    width: "100%",
    maxWidth: 720,
    maxHeight: "85%",
    alignSelf: "center",
    backgroundColor: "#131d2a",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: "#2b3b50",
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#47576b",
    alignSelf: "center",
    marginBottom: 20,
  },
  heading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 22,
  },
  title: { fontSize: 21, lineHeight: 28, fontWeight: "700", color: "#f3f6fa" },
  description: { fontSize: 13, lineHeight: 21, color: "#9faec1" },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#1f2c3d",
  },
  actions: { gap: 10, paddingBottom: 4 },
  action: {
    minHeight: 80,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2b3b50",
    backgroundColor: "#192637",
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  selectedAction: { backgroundColor: "#253325", borderColor: "#647b40" },
  actionTitle: { fontSize: 15, fontWeight: "600", color: "#edf3fa" },
  actionDescription: { fontSize: 12, lineHeight: 18, color: "#9faec1" },
  selectedText: { color: "#d7f3b2" },
  dangerAction: { backgroundColor: "#30222b", borderColor: "#593644" },
  dangerText: { color: "#ffb4ab" },
  dangerDescription: { color: "#cba6ab" },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#73839a",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: "#c5ef86" },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 6,
    backgroundColor: "#c5ef86",
  },
  cancel: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 14,
  },
  cancelText: { fontSize: 14, fontWeight: "600", color: "#b3c0d1" },
  pressed: { opacity: 0.65 },
});
