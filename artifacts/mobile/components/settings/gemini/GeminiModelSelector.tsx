/**
 * GeminiModelSelector — model selection cards.
 * Reads/writes geminiModel from SettingsContext.
 * Does NOT touch translation logic.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/context/SettingsContext";
import { GEMINI_MODELS, type GeminiModel } from "@/services/geminiKeyTest";

// Daily limit display
function dailyLimitLabel(rpd: number): string {
  return rpd >= 1000 ? `${rpd / 1000}k/day` : `${rpd}/day`;
}

export function GeminiModelSelector() {
  const colors = useColors();
  const { geminiModel, setGeminiModel } = useSettings();

  // One scale anim per card
  const scaleAnims = useRef<Record<string, Animated.Value>>(
    Object.fromEntries(GEMINI_MODELS.map((m) => [m.id, new Animated.Value(1)]))
  ).current;

  const handleSelect = (id: GeminiModel) => {
    if (id === geminiModel) return;
    const anim = scaleAnims[id];
    if (anim) {
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.96, duration: 70, useNativeDriver: true }),
        Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 5 }),
      ]).start();
    }
    setGeminiModel(id);
  };

  return (
    <View style={styles.grid}>
      {GEMINI_MODELS.map((model) => {
        const selected = model.id === geminiModel;
        const borderColor = selected ? colors.primary : colors.border;
        const bg = selected ? `${colors.primary}0D` : colors.card;

        return (
          <Animated.View
            key={model.id}
            style={[styles.cardWrap, { transform: [{ scale: scaleAnims[model.id] ?? new Animated.Value(1) }] }]}
          >
            <Pressable
              onPress={() => handleSelect(model.id)}
              style={[styles.card, { backgroundColor: bg, borderColor, borderRadius: colors.radius }]}
            >
              {/* Recommended badge */}
              {model.recommended && (
                <View style={[styles.recommendedBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.recommendedText}>★ Free · Recommended</Text>
                </View>
              )}

              {/* Header row */}
              <View style={styles.cardHeader}>
                <View style={[styles.modelIconWrap, { backgroundColor: selected ? `${colors.primary}20` : colors.muted }]}>
                  <Ionicons
                    name="flash-outline"
                    size={16}
                    color={selected ? colors.primary : colors.mutedForeground}
                  />
                </View>
                {selected && (
                  <View style={[styles.selectedDot, { backgroundColor: colors.primary }]}>
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  </View>
                )}
              </View>

              {/* Name */}
              <Text style={[styles.modelName, { color: selected ? colors.primary : colors.foreground }]}>
                {model.displayName}
              </Text>

              {/* Tagline */}
              <Text style={[styles.tagline, { color: colors.mutedForeground }]} numberOfLines={2}>
                {model.tagline}
              </Text>

              {/* Tier + limits */}
              <View style={styles.limitsRow}>
                <View style={[styles.tierBadge, {
                  backgroundColor: model.tier === "free" ? "#16a34a18" : "#f59e0b18",
                }]}>
                  <Text style={[styles.tierText, { color: model.tier === "free" ? "#16a34a" : "#f59e0b" }]}>
                    {model.tier === "free" ? "Free" : "Paid"}
                  </Text>
                </View>
                <Text style={[styles.limitsText, { color: colors.mutedForeground }]}>
                  {model.rpm} rpm · {dailyLimitLabel(model.rpd)}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
  },
  cardWrap: {
    flex: 1,
  },
  card: {
    borderWidth: 1.5,
    padding: 11,
    gap: 5,
    minHeight: 130,
  },
  recommendedBadge: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: "center" as const,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  recommendedText: {
    fontSize: 9,
    fontWeight: "700" as const,
    color: "#fff",
    letterSpacing: 0.3,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18, // space for recommended badge
  },
  modelIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  modelName: {
    fontSize: 12,
    fontWeight: "700" as const,
    lineHeight: 16,
  },
  tagline: {
    fontSize: 10,
    lineHeight: 14,
  },
  limitsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  tierBadge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  tierText: {
    fontSize: 9,
    fontWeight: "700" as const,
  },
  limitsText: {
    fontSize: 9,
    fontWeight: "500" as const,
  },
});
