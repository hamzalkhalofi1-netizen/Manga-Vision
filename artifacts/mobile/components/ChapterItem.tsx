import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Chapter } from "@/services/sources/types";

interface Props {
  chapter: Chapter;
  onPress: () => void;
  isRead?: boolean;
  isCurrent?: boolean;
}

export function ChapterItem({ chapter, onPress, isRead = false, isCurrent = false }: Props) {
  const colors = useColors();

  const date = (() => {
    try {
      return new Date(chapter.publishedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "";
    }
  })();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: isCurrent
            ? `${colors.primary}18`
            : pressed
            ? "rgba(255,255,255,0.04)"
            : "transparent",
          borderLeftWidth: isCurrent ? 3 : 0,
          borderLeftColor: colors.primary,
        },
      ]}
    >
      <View style={styles.left}>
        <Text
          style={[
            styles.number,
            {
              color: isCurrent
                ? colors.primary
                : isRead
                ? colors.mutedForeground
                : colors.foreground,
            },
          ]}
        >
          Ch. {chapter.number}
          {chapter.title ? ` — ${chapter.title}` : ""}
        </Text>
        <View style={styles.meta}>
          {chapter.scanlator && (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {chapter.scanlator}
            </Text>
          )}
          {date ? (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {date}
            </Text>
          ) : null}
          {chapter.pages && (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {chapter.pages}p
            </Text>
          )}
        </View>
      </View>
      <View style={styles.right}>
        {isRead && (
          <Ionicons
            name="checkmark-circle"
            size={16}
            color={colors.mutedForeground}
          />
        )}
        {isCurrent && (
          <Ionicons name="play-circle" size={18} color={colors.primary} />
        )}
        <Ionicons
          name="chevron-forward"
          size={14}
          color={colors.mutedForeground}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: "space-between",
  },
  left: {
    flex: 1,
    gap: 3,
  },
  number: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
  meta: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: 11,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});
