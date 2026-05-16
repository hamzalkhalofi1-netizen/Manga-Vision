import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { ALL_SOURCES } from "@/services/sources";
import { useSettings } from "@/context/SettingsContext";

interface Props {
  showAll?: boolean;
}

export function SourceSwitcher({ showAll = false }: Props) {
  const colors = useColors();
  const { activeSourceId, setActiveSourceId } = useSettings();

  const sources = showAll
    ? ALL_SOURCES
    : ALL_SOURCES.filter((s) => s.isEnabled || s.id === "mangadex");

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {sources.map((source) => {
        const isActive = source.id === activeSourceId;
        return (
          <Pressable
            key={source.id}
            onPress={() => setActiveSourceId(source.id)}
            style={[
              styles.pill,
              {
                backgroundColor: isActive
                  ? colors.primary
                  : "rgba(255,255,255,0.06)",
                borderColor: isActive
                  ? colors.primary
                  : "rgba(255,255,255,0.1)",
                borderRadius: 20,
                opacity: source.isEnabled || source.id === "mangadex" ? 1 : 0.5,
              },
            ]}
          >
            {isActive && (
              <View style={styles.dot} />
            )}
            <Text
              style={[
                styles.label,
                { color: isActive ? "#fff" : colors.mutedForeground },
              ]}
            >
              {source.name}
            </Text>
            {!source.isEnabled && source.id !== "mangadex" && (
              <Text style={styles.soonLabel}>Soon</Text>
            )}
          </Pressable>
        );
      })}
      <Pressable
        style={[
          styles.pill,
          {
            backgroundColor: "rgba(255,255,255,0.04)",
            borderColor: "rgba(255,255,255,0.08)",
            borderRadius: 20,
          },
        ]}
      >
        <Ionicons name="add" size={14} color={colors.mutedForeground} />
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          More
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  label: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  soonLabel: {
    fontSize: 9,
    color: "#888",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
});
