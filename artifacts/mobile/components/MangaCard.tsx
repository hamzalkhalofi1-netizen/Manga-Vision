import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useColors } from "@/hooks/useColors";
import { Manga } from "@/services/sources/types";

interface Props {
  manga: Manga;
  onPress: () => void;
  size?: "small" | "medium" | "large";
  showStatus?: boolean;
}

const SIZES = {
  small: { width: 110, height: 155 },
  medium: { width: 140, height: 200 },
  large: { width: 180, height: 260 },
};

const STATUS_COLORS: Record<string, string> = {
  ongoing: "#4CAF50",
  completed: "#2196F3",
  hiatus: "#FF9800",
  cancelled: "#F44336",
};

export function MangaCard({ manga, onPress, size = "medium", showStatus = true }: Props) {
  const colors = useColors();
  const scale = useSharedValue(1);
  const dims = SIZES[size];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.94, { damping: 15 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15 });
      }}
    >
      <Animated.View
        style={[
          styles.card,
          {
            width: dims.width,
            height: dims.height,
            borderRadius: colors.radius,
            backgroundColor: colors.card,
            shadowColor: colors.primary,
          },
          animatedStyle,
        ]}
      >
        <Image
          source={{ uri: manga.coverUrl }}
          style={[StyleSheet.absoluteFill, { borderRadius: colors.radius }]}
          contentFit="cover"
          transition={300}
        />
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.5)", "rgba(0,0,0,0.95)"]}
          locations={[0.4, 0.7, 1]}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: colors.radius, justifyContent: "flex-end", padding: 8 },
          ]}
        >
          {showStatus && manga.status && (
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: STATUS_COLORS[manga.status] ?? colors.primary },
              ]}
            >
              <Text style={styles.statusText}>
                {manga.status.toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.title} numberOfLines={2}>
            {manga.title}
          </Text>
          {manga.rating && (
            <Text style={styles.rating}>
              {"\u2605"} {manga.rating.toFixed(1)}
            </Text>
          )}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  statusText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600" as const,
    lineHeight: 16,
  },
  rating: {
    color: "#FFD700",
    fontSize: 10,
    marginTop: 2,
  },
});
