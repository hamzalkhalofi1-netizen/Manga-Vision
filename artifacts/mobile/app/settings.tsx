import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";

type Language = { code: string; label: string };

const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
];

function SectionLabel({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionLabel, { color: colors.primary }]}>{title.toUpperCase()}</Text>
  );
}

function SettingRow({
  icon,
  label,
  description,
  right,
  onPress,
  last,
}: {
  icon: string;
  label: string;
  description?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? "rgba(255,255,255,0.04)" : "transparent",
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: `${colors.primary}20` }]}>
        <Ionicons name={icon as never} size={18} color={colors.primary} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        {description && (
          <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{description}</Text>
        )}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { readerSettings, updateReaderSettings } = useSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* Reader */}
        <View style={styles.section}>
          <SectionLabel title="Reader" />
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <SettingRow
              icon="phone-portrait-outline"
              label="Reading Mode"
              description={readerSettings.readingMode === "vertical" ? "Vertical Scroll" : "Horizontal Pages"}
              right={
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => updateReaderSettings({ readingMode: "vertical" })}
                    style={[
                      styles.toggleOption,
                      {
                        backgroundColor:
                          readerSettings.readingMode === "vertical"
                            ? colors.primary
                            : "transparent",
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          readerSettings.readingMode === "vertical"
                            ? "#fff"
                            : colors.mutedForeground,
                        fontSize: 12,
                        fontWeight: "500" as const,
                      }}
                    >
                      Vertical
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => updateReaderSettings({ readingMode: "horizontal" })}
                    style={[
                      styles.toggleOption,
                      {
                        backgroundColor:
                          readerSettings.readingMode === "horizontal"
                            ? colors.primary
                            : "transparent",
                        borderRadius: 8,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          readerSettings.readingMode === "horizontal"
                            ? "#fff"
                            : colors.mutedForeground,
                        fontSize: 12,
                        fontWeight: "500" as const,
                      }}
                    >
                      Horizontal
                    </Text>
                  </Pressable>
                </View>
              }
            />
            <SettingRow
              icon="phone-portrait-outline"
              label="Show Page Number"
              right={
                <Switch
                  value={readerSettings.showPageNumber}
                  onValueChange={(v) => updateReaderSettings({ showPageNumber: v })}
                  trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                  thumbColor={readerSettings.showPageNumber ? colors.primary : colors.mutedForeground}
                />
              }
              last
            />
          </View>
        </View>

        {/* Data */}
        <View style={styles.section}>
          <SectionLabel title="Data & Performance" />
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <SettingRow
              icon="speedometer-outline"
              label="Data Saver"
              description="Use compressed images to save bandwidth"
              right={
                <Switch
                  value={readerSettings.dataSaver}
                  onValueChange={(v) => updateReaderSettings({ dataSaver: v })}
                  trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                  thumbColor={readerSettings.dataSaver ? colors.primary : colors.mutedForeground}
                />
              }
              last
            />
          </View>
        </View>

        {/* AI Translation */}
        <View style={styles.section}>
          <SectionLabel title="AI Translation" />
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <SettingRow
              icon="language-outline"
              label="Target Language"
              description={LANGUAGES.find((l) => l.code === readerSettings.targetLanguage)?.label}
            />
            <View style={styles.langGrid}>
              {LANGUAGES.map((lang) => {
                const active = lang.code === readerSettings.targetLanguage;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => updateReaderSettings({ targetLanguage: lang.code as never })}
                    style={[
                      styles.langPill,
                      {
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderRadius: 10,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.langText,
                        { color: active ? "#fff" : colors.mutedForeground },
                      ]}
                    >
                      {lang.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* About */}
        <View style={styles.section}>
          <SectionLabel title="About" />
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <SettingRow
              icon="information-circle-outline"
              label="MangaVerse"
              description="Version 1.0.0"
              right={null}
              last
            />
          </View>
          <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
            MangaVerse aggregates content from legal public sources including MangaDex. All content is provided in accordance with the respective platform's Terms of Service.
          </Text>
        </View>
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
    paddingBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 20,
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMiddle: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
  },
  rowDesc: {
    fontSize: 12,
  },
  toggleRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  toggleOption: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  langGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  langPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  langText: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
});
