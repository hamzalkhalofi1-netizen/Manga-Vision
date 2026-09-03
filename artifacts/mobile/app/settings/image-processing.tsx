import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/context/SettingsContext";
import {
  SettingsItem,
  SettingsOptionSelector,
  SettingsSection,
  SettingsToggle,
} from "@/components/settings";
import { SettingsSlider } from "@/components/settings/SettingsSlider";

const REMOVAL_OPTIONS = [
  { value: "inpaint", label: "Inpaint" },
  { value: "overlay", label: "Overlay" },
];

export default function ImageProcessingSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { imageProcessingSettings, updateImageProcessingSettings } = useSettings();
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Image Processing</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPadding }}>
        <SettingsSection title="Text Removal" icon="color-wand-outline" defaultExpanded>
          <SettingsItem
            icon="layers-outline"
            label="Removal Mode"
            description={imageProcessingSettings.removalMode === "inpaint"
              ? "Reconstruct the bubble background with the CV server"
              : "Draw translations over the original page"}
            noChevron
            right={
              <SettingsOptionSelector
                options={REMOVAL_OPTIONS}
                selected={imageProcessingSettings.removalMode}
                onChange={(value) =>
                  updateImageProcessingSettings({ removalMode: value as "inpaint" | "overlay" })
                }
                layout="row"
              />
            }
          />
          <View style={styles.slider}>
            <SettingsSlider
              label="Mask Padding"
              value={imageProcessingSettings.maskPadding}
              min={0}
              max={24}
              step={1}
              unit="px"
              onChange={(value) => updateImageProcessingSettings({ maskPadding: value })}
              formatValue={(value) => `${value}px`}
              presets={[
                { label: "0", value: 0 },
                { label: "4", value: 4 },
                { label: "8", value: 8 },
                { label: "12", value: 12 },
              ]}
            />
          </View>
          <SettingsItem
            icon="ellipse-outline"
            label="Preserve Bubble Borders"
            description="Keep outlines intact while removing source text"
            noChevron
            last
            right={
              <SettingsToggle
                value={imageProcessingSettings.preserveBubbleBorders}
                onValueChange={(value) => updateImageProcessingSettings({ preserveBubbleBorders: value })}
              />
            }
          />
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "600" as const },
  slider: { paddingHorizontal: 14, paddingVertical: 14 },
});