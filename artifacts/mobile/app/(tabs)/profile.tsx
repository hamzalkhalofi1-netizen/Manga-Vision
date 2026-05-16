import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
import { useLibrary } from "@/context/LibraryContext";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";

function StatCard({ icon, value, label }: { icon: string; value: string | number; label: string }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
      ]}
    >
      <Ionicons name={icon as never} size={22} color={colors.primary} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function SettingRow({
  icon,
  label,
  value,
  onPress,
  danger,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        {
          backgroundColor: pressed ? "rgba(255,255,255,0.04)" : "transparent",
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.settingLeft}>
        <Ionicons
          name={icon as never}
          size={20}
          color={danger ? colors.destructive : colors.primary}
        />
        <Text style={[styles.settingLabel, { color: danger ? colors.destructive : colors.foreground }]}>
          {label}
        </Text>
      </View>
      <View style={styles.settingRight}>
        {value && (
          <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>{value}</Text>
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { entries, totalChaptersRead } = useLibrary();
  const { translationCount, readerSettings } = useSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 100 + (Platform.OS === "web" ? 34 : insets.bottom);

  const reading = entries.filter((e) => e.status === "reading").length;
  const completed = entries.filter((e) => e.status === "completed").length;
  const favorites = entries.filter((e) => e.status === "favorites").length;

  const allGenres = entries.flatMap((e) => e.manga.genres ?? []);
  const genreCounts: Record<string, number> = {};
  allGenres.forEach((g) => {
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });
  const topGenres = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([g]) => g);

  const LANG_LABELS: Record<string, string> = {
    en: "English", es: "Spanish", pt: "Portuguese",
    fr: "French", de: "German", ja: "Japanese",
    ko: "Korean", zh: "Chinese",
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header Banner */}
      <LinearGradient
        colors={[`${colors.primary}30`, `${colors.primary}08`, "transparent"]}
        style={[styles.banner, { paddingTop: topPadding + 24 }]}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: colors.primary, borderColor: colors.background },
          ]}
        >
          <Ionicons name="person" size={36} color="#fff" />
        </View>
        <Text style={[styles.username, { color: colors.foreground }]}>Manga Reader</Text>
        <Text style={[styles.joinDate, { color: colors.mutedForeground }]}>
          {entries.length} manga in library
        </Text>
      </LinearGradient>

      {/* Stats */}
      <View style={styles.statsRow}>
        <StatCard icon="book-outline" value={entries.length} label="In Library" />
        <StatCard icon="checkmark-done-outline" value={completed} label="Completed" />
        <StatCard icon="heart-outline" value={favorites} label="Favorites" />
        <StatCard icon="time-outline" value={reading} label="Reading" />
      </View>

      {/* AI Translation Stats */}
      <View style={[styles.aiCard, { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}30`, borderRadius: colors.radius }]}>
        <View style={styles.aiHeader}>
          <Ionicons name="sparkles" size={20} color={colors.primary} />
          <Text style={[styles.aiTitle, { color: colors.primary }]}>AI Translation</Text>
        </View>
        <Text style={[styles.aiCount, { color: colors.foreground }]}>
          {translationCount} translations used
        </Text>
        <Text style={[styles.aiLang, { color: colors.mutedForeground }]}>
          Current language: {LANG_LABELS[readerSettings.targetLanguage] || readerSettings.targetLanguage}
        </Text>
      </View>

      {/* Top Genres */}
      {topGenres.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Favorite Genres
          </Text>
          <View style={styles.genreRow}>
            {topGenres.map((g) => (
              <View
                key={g}
                style={[
                  styles.genrePill,
                  { backgroundColor: `${colors.primary}20`, borderColor: `${colors.primary}40`, borderRadius: 14 },
                ]}
              >
                <Text style={[styles.genreText, { color: colors.primary }]}>{g}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Settings Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>App</Text>
        <View
          style={[
            styles.settingsCard,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <SettingRow
            icon="settings-outline"
            label="Settings"
            onPress={() => router.push("/settings")}
          />
          <SettingRow
            icon="language-outline"
            label="Translation Language"
            value={LANG_LABELS[readerSettings.targetLanguage]}
            onPress={() => router.push("/settings")}
          />
          <SettingRow
            icon="book-outline"
            label="Reading Mode"
            value={readerSettings.readingMode === "vertical" ? "Vertical Scroll" : "Horizontal Pages"}
            onPress={() => router.push("/settings")}
          />
          <SettingRow
            icon="information-circle-outline"
            label="About MangaVerse"
            onPress={() => {}}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    alignItems: "center",
    paddingBottom: 24,
  },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    marginBottom: 12,
  },
  username: {
    fontSize: 22,
    fontWeight: "700" as const,
  },
  joinDate: {
    fontSize: 13,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    gap: 4,
    borderWidth: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700" as const,
  },
  statLabel: {
    fontSize: 10,
    textAlign: "center",
  },
  aiCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    gap: 4,
  },
  aiHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  aiTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  aiCount: {
    fontSize: 20,
    fontWeight: "700" as const,
  },
  aiLang: {
    fontSize: 12,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
  },
  genreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  genrePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  settingsCard: {
    borderWidth: 1,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingLabel: {
    fontSize: 15,
  },
  settingRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingValue: {
    fontSize: 13,
  },
});
