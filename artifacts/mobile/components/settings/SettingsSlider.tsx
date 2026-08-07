import React, { useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

interface SettingsSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  unit?: string;
  /** Optional quick-tap shortcuts below the slider */
  presets?: Array<{ label: string; value: number }>;
}

const THUMB_SIZE = 22;

export function SettingsSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  unit,
  presets,
}: SettingsSliderProps) {
  const colors = useColors();
  const [trackWidth, setTrackWidth] = useState(0);
  const startXRef = useRef(0);
  const startValueRef = useRef(value);
  const currentValueRef = useRef(value);

  // Keep ref in sync so panResponder always sees the latest value
  currentValueRef.current = value;

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const snap = (v: number) =>
    step === 1 ? Math.round(v) : Math.round(v / step) * step;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        startXRef.current = e.nativeEvent.locationX;
        startValueRef.current = currentValueRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        if (!trackWidth) return;
        const delta = (gestureState.dx / trackWidth) * (max - min);
        onChange(snap(clamp(startValueRef.current + delta)));
      },
      onPanResponderRelease: () => {},
    })
  ).current;

  const ratio = trackWidth > 0 ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const fillWidth = ratio * trackWidth;
  const thumbLeft = fillWidth - THUMB_SIZE / 2;

  const displayValue = formatValue
    ? formatValue(value)
    : unit
    ? `${typeof value === "number" && step < 1 ? value.toFixed(1) : value}${unit}`
    : String(typeof value === "number" && step < 1 ? value.toFixed(1) : value);

  return (
    <View style={styles.container}>
      {/* Label row */}
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.valueText, { color: colors.primary }]}>{displayValue}</Text>
      </View>

      {/* Track */}
      <View
        style={[styles.trackWrap, { backgroundColor: colors.muted }]}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
      >
        {/* Fill */}
        <View
          style={[
            styles.fill,
            { width: Math.max(0, fillWidth), backgroundColor: colors.primary },
          ]}
        />
        {/* Thumb */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.thumb,
              {
                left: Math.max(0, thumbLeft),
                backgroundColor: colors.primary,
                borderColor: colors.background,
                shadowColor: colors.primary,
              },
            ]}
          />
        )}
      </View>

      {/* Min / Max labels */}
      <View style={styles.rangeRow}>
        <Text style={[styles.rangeText, { color: colors.mutedForeground }]}>
          {formatValue ? formatValue(min) : `${min}${unit ?? ""}`}
        </Text>
        <Text style={[styles.rangeText, { color: colors.mutedForeground }]}>
          {formatValue ? formatValue(max) : `${max}${unit ?? ""}`}
        </Text>
      </View>

      {/* Presets */}
      {presets && presets.length > 0 && (
        <View style={styles.presetsRow}>
          {presets.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => onChange(p.value)}
              style={[
                styles.presetBtn,
                {
                  backgroundColor:
                    value === p.value ? `${colors.primary}20` : colors.muted,
                  borderColor:
                    value === p.value ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.presetText,
                  { color: value === p.value ? colors.primary : colors.mutedForeground },
                ]}
              >
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: { fontSize: 14, fontWeight: "500" as const },
  valueText: { fontSize: 14, fontWeight: "600" as const },
  trackWrap: {
    height: 6,
    borderRadius: 3,
    position: "relative",
    justifyContent: "center",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    top: -(THUMB_SIZE / 2 - 3),
  },
  rangeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
  },
  rangeText: { fontSize: 10 },
  presetsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  presetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  presetText: { fontSize: 11, fontWeight: "500" as const },
});
