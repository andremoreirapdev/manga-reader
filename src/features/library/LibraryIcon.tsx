import { View } from "react-native";

type IconName =
  "book" | "search" | "plus" | "compass" | "sort" | "close" | "more" | "arrow";

/** Ícones geométricos nativos, sem pacote ou fonte adicional. */
export function LibraryIcon({
  name,
  color = "#a7b3c3",
}: {
  name: IconName;
  color?: string;
}) {
  const line = (left: number, top: number, width: number, rotation = 0) => (
    <View
      style={{
        position: "absolute",
        left,
        top,
        width,
        height: 1.8,
        borderRadius: 2,
        backgroundColor: color,
        transform: [{ rotate: `${rotation}deg` }],
      }}
    />
  );

  return (
    <View
      accessible={false}
      pointerEvents="none"
      style={{ width: 24, height: 24 }}
    >
      {name === "search" && (
        <>
          <View
            style={{
              position: "absolute",
              left: 3,
              top: 2,
              width: 14,
              height: 14,
              borderWidth: 1.8,
              borderRadius: 8,
              borderColor: color,
            }}
          />
          {line(15, 18, 7, 45)}
        </>
      )}
      {name === "plus" && (
        <>
          {line(4, 11, 16)}
          {line(4, 11, 16, 90)}
        </>
      )}
      {name === "close" && (
        <>
          {line(4, 11, 16, 45)}
          {line(4, 11, 16, -45)}
        </>
      )}
      {name === "sort" && (
        <>
          {line(3, 5, 18)}
          {line(3, 11, 12)}
          {line(3, 17, 6)}
        </>
      )}
      {name === "arrow" && (
        <>
          {line(4, 11, 16)}
          {line(14, 8, 8, 45)}
          {line(14, 14, 8, -45)}
        </>
      )}
      {name === "more" &&
        [5, 11, 17].map((top) => (
          <View
            key={top}
            style={{
              position: "absolute",
              left: 10,
              top,
              width: 3,
              height: 3,
              borderRadius: 2,
              backgroundColor: color,
            }}
          />
        ))}
      {name === "book" && (
        <>
          <View
            style={{
              position: "absolute",
              left: 2,
              top: 4,
              width: 10,
              height: 16,
              borderWidth: 1.6,
              borderTopLeftRadius: 4,
              borderBottomLeftRadius: 4,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: 12,
              top: 4,
              width: 10,
              height: 16,
              borderWidth: 1.6,
              borderTopRightRadius: 4,
              borderBottomRightRadius: 4,
              borderColor: color,
            }}
          />
        </>
      )}
      {name === "compass" && (
        <>
          <View
            style={{
              position: "absolute",
              left: 2,
              top: 2,
              width: 20,
              height: 20,
              borderWidth: 1.6,
              borderRadius: 12,
              borderColor: color,
            }}
          />
          {line(5, 11, 14, -45)}
          {line(12, 7, 6)}
          {line(7, 15, 6)}
        </>
      )}
    </View>
  );
}
