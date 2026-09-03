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
  SettingsSection,
  SettingsItem,
  SettingsToggle,
  SettingsOptionSelector,
} from "@/components/settings";
import { SettingsSlider } from "@/components/settings/SettingsSlider";

const READING_MODE_OPTS = [
  { value: "vertical",   label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
];

const DIRECTION_OPTS = [
  { value: "ltr", label: "LTR" },
  { value: "rtl", label: "RTL" },
];

const TRANSITION_OPTS = [
  { value: "scroll", label: "Scroll" },
  { value: "swipe",  label: "Swipe" },
];

const FIT_OPTS = [
  { value: "width",  label: "Width" },
  { value: "height", label: "Height" },
  { value: "screen", label: "Screen" },
];

export default function ReaderSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { readerSettings, updateReaderSettings } = useSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Reader</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Reading ───────────────────────────────────────────────────── */}
        <SettingsSection title="Reading" icon="book-outline" defaultExpanded>
          <SettingsItem
            icon="phone-portrait-outline"
            label="Reading Mode"
            description={readerSettings.readingMode === "vertical" ? "Vertical scroll" : "Page-by-page"}
            noChevron
            right={
              <SettingsOptionSelector
                options={READING_MODE_OPTS}
                selected={readerSettings.readingMode}
                onChange={(v) => updateReaderSettings({ readingMode: v as never })}
                layout="row"
              />
            }
          />
          <SettingsItem
            icon="arrow-forward-outline"
            label="Reading Direction"
            description={readerSettings.readingDirection === "ltr" ? "Left to right" : "Right to left (manga)"}
            noChevron
            right={
              <SettingsOptionSelector
                options={DIRECTION_OPTS}
                selected={readerSettings.readingDirection}
                onChange={(v) => updateReaderSettings({ readingDirection: v as never })}
                layout="row"
              />
            }
          />
          <SettingsItem
            icon="swap-horizontal-outline"
            label="Page Transition"
            description={
              readerSettings.readingMode === "vertical"
                ? "Webtoon always uses continuous vertical scrolling"
                : readerSettings.pageTransition === "scroll"
                  ? "Smooth scrolling"
                  : "Swipe pages"
            }
            noChevron
            right={
              <SettingsOptionSelector
                options={TRANSITION_OPTS}
                selected={readerSettings.pageTransition}
                onChange={(v) => updateReaderSettings({ pageTransition: v as never })}
                layout="row"
              />
            }
          />
          <SettingsItem
            icon="sparkles-outline"
            label="Page Animation"
            description="Animate page transitions"
            last
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.pageAnimation}
                onValueChange={(v) => updateReaderSettings({ pageAnimation: v })}
              />
            }
          />
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* ── Display ───────────────────────────────────────────────────── */}
        <SettingsSection title="Display" icon="desktop-outline" defaultExpanded>
          <SettingsItem
            icon="sunny-outline"
            label="Keep Screen Awake"
            description="Prevent screen from sleeping while reading"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.keepScreenAwake}
                onValueChange={(v) => updateReaderSettings({ keepScreenAwake: v })}
              />
            }
          />
          <SettingsItem
            icon="expand-outline"
            label="Hide System Bars"
            description="Full immersive reading mode"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.hideSystemBars}
                onValueChange={(v) => updateReaderSettings({ hideSystemBars: v })}
              />
            }
          />
          <SettingsItem
            icon="layers-outline"
            label="Show Page Number"
            description="Display current page overlay"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.showPageNumber}
                onValueChange={(v) => updateReaderSettings({ showPageNumber: v })}
              />
            }
          />
          <SettingsItem
            icon="bar-chart-outline"
            label="Reading Progress Bar"
            description="Show progress bar at top of reader"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.showProgressBar}
                onValueChange={(v) => updateReaderSettings({ showProgressBar: v })}
              />
            }
          />

          {/* Brightness */}
          <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
            <SettingsSlider
              label="Brightness"
              value={readerSettings.brightness === -1 ? 0 : Math.round(readerSettings.brightness * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => updateReaderSettings({ brightness: v === 0 && readerSettings.brightness === -1 ? -1 : v / 100 })}
              formatValue={(v) => v === 0 ? "Auto" : `${v}%`}
              presets={[
                { label: "Auto", value: 0 },
                { label: "50%", value: 50 },
                { label: "80%", value: 80 },
                { label: "100%", value: 100 },
              ]}
            />
          </View>
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* ── Interaction ───────────────────────────────────────────────── */}
        <SettingsSection title="Interaction" icon="hand-left-outline" defaultExpanded>
          <SettingsItem
            icon="scan-outline"
            label="Double Tap Zoom"
            description="Double-tap to zoom in/out"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.doubleTapZoom}
                onValueChange={(v) => updateReaderSettings({ doubleTapZoom: v })}
              />
            }
          />
          <SettingsItem
            icon="resize-outline"
            label="Pinch Zoom"
            description="Pinch gesture to zoom"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.pinchZoom}
                onValueChange={(v) => updateReaderSettings({ pinchZoom: v })}
              />
            }
          />
          <SettingsItem
            icon="contract-outline"
            label="Fit Mode"
            description={readerSettings.fitMode === "width" ? "Fit to screen width" : readerSettings.fitMode === "height" ? "Fit to screen height" : "Fit entire screen"}
            noChevron
            last
            right={
              <SettingsOptionSelector
                options={FIT_OPTS}
                selected={readerSettings.fitMode}
                onChange={(v) => updateReaderSettings({ fitMode: v as never })}
                layout="row"
              />
            }
          />
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* ── Pages ─────────────────────────────────────────────────────── */}
        <SettingsSection title="Pages" icon="images-outline" defaultExpanded>
          <SettingsItem
            icon="leaf-outline"
            label="Data Saver"
            description="Use a smaller preload window and one download at a time"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.dataSaver}
                onValueChange={(v) => updateReaderSettings({ dataSaver: v })}
              />
            }
          />
          <SettingsItem
            icon="bookmark-outline"
            label="Remember Last Page"
            description="Resume from where you left off"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.rememberLastPage}
                onValueChange={(v) => updateReaderSettings({ rememberLastPage: v })}
              />
            }
          />
          <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
            <SettingsSlider
              label="Preload Next Pages"
              value={readerSettings.preloadPages}
              min={1}
              max={5}
              onChange={(v) => updateReaderSettings({ preloadPages: v })}
              formatValue={(v) => `${v} page${v !== 1 ? "s" : ""}`}
              presets={[
                { label: "1", value: 1 },
                { label: "2", value: 2 },
                { label: "3", value: 3 },
                { label: "5", value: 5 },
              ]}
            />
          </View>
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
});
