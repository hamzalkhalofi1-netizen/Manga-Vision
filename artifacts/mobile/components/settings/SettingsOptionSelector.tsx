import React, { useRef } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

export interface SelectOption {
  value: string;
  label: string;
}

interface SettingsOptionSelectorProps {
  options: SelectOption[];
  selected: string;
  onChange: (value: string) => void;
  /**
   * "row"  — horizontal non-wrapping row (default, for 2-4 short options).
   * "wrap" — wrapping pill grid (for many options like languages).
   */
  layout?: "row" | "wrap";
}

/**
 * Animated multi-option pill selector.
 *
 * Use layout="row"  for short option sets (Theme, Reading Mode).
 * Use layout="wrap" for large option grids (Target Language).
 */
export function SettingsOptionSelector({
  options,
  selected,
  onChange,
  layout = "row",
}: SettingsOptionSelectorProps) {
  const colors = useColors();

  // One scale anim per option so the newly-selected pill springs up
  const scaleAnims = useRef<Record<string, Animated.Value>>(
    Object.fromEntries(options.map((o) => [o.value, new Animated.Value(1)]))
  ).current;

  const handlePress = (value: string) => {
    if (value === selected) return;
    // Brief spring on the selected pill
    const anim = scaleAnims[value];
    if (anim) {
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.88, duration: 80, useNativeDriver: true }),
        Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }),
      ]).start();
    }
    onChange(value);
  };

  if (layout === "row") {
    return (
      <View style={[styles.rowWrap, { backgroundColor: `${colors.foreground}0D`, borderRadius: 10 }]}>
        {options.map((opt) => {
          const active = opt.value === selected;
          return (
            <Animated.View
              key={opt.value}
              style={{ transform: [{ scale: scaleAnims[opt.value] ?? new Animated.Value(1) }] }}
            >
              <Pressable
                onPress={() => handlePress(opt.value)}
                style={[
                  styles.rowOption,
                  {
                    backgroundColor: active ? colors.primary : "transparent",
                    borderRadius: 8,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    { color: active ? "#fff" : colors.mutedForeground },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    );
  }

  // Wrap grid layout (e.g. language picker)
  return (
    <View style={styles.grid}>
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <Animated.View
            key={opt.value}
            style={{ transform: [{ scale: scaleAnims[opt.value] ?? new Animated.Value(1) }] }}
          >
            <Pressable
              onPress={() => handlePress(opt.value)}
              style={[
                styles.gridPill,
                {
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderRadius: 10,
                },
              ]}
            >
              <Text style={[styles.optionText, { color: active ? "#fff" : colors.mutedForeground }]}>
                {opt.label}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    flexDirection: "row",
    padding: 3,
    gap: 2,
  },
  rowOption: {
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
  },
  gridPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  optionText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
});
