import React from "react";
import { Switch, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SettingsToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/**
 * Themed Switch — designed to be used as the `right` prop of SettingsItem.
 */
export function SettingsToggle({ value, onValueChange, disabled = false }: SettingsToggleProps) {
  const colors = useColors();

  return (
    <View style={styles.wrap}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{
          false: colors.border,
          true: `${colors.primary}90`,
        }}
        thumbColor={value ? colors.primary : colors.mutedForeground}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexShrink: 0,
  },
});
