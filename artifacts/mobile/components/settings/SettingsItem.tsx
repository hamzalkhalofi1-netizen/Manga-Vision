import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SettingsItemProps {
  icon: string;
  label: string;
  description?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  /** Red tint for destructive actions */
  destructive?: boolean;
  /** Hides the chevron even when no right element is provided */
  noChevron?: boolean;
}

export function SettingsItem({
  icon,
  label,
  description,
  right,
  onPress,
  last = false,
  destructive = false,
  noChevron = false,
}: SettingsItemProps) {
  const colors = useColors();

  const labelColor = destructive ? colors.destructive : colors.foreground;
  const iconBg = destructive ? `${colors.destructive}1A` : `${colors.primary}1A`;
  const iconColor = destructive ? colors.destructive : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress && right === undefined}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed && onPress ? `${colors.primary}08` : "transparent",
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
      ]}
    >
      {/* Icon box */}
      <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
        <Ionicons name={icon as never} size={17} color={iconColor} />
      </View>

      {/* Label + description */}
      <View style={styles.middle}>
        <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>

      {/* Right slot */}
      {right !== undefined ? (
        right
      ) : !noChevron && onPress ? (
        <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
    minHeight: 52,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 15,
    fontWeight: "400" as const,
    lineHeight: 20,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
});
