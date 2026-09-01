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
import { useTokens } from "@/context/TokenContext";
import { useColors } from "@/hooks/useColors";

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string | number;
  label: string;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
      ]}
    >
      <Ionicons name={icon as never} size={20} color={colors.primary} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Ionicons name={icon as never} size={15} color={colors.primary} />
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

// ── Settings link row ─────────────────────────────────────────────────────────

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
          <Text style={[styles.settingValue, { color: colors.mutedForeground }]} numberOfLines={1}>
            {value}
          </Text>
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const LANG_LABELS: Record<string, string> = {
  en: "English", ar: "العربية", es: "Español", pt: "Português",
  fr: "Français", de: "Deutsch", ja: "日本語", ko: "한국어", zh: "中文",
};

const MODEL_LABELS: Record<string, string> = {
  "gemini-2.5-flash":    "Gemini 2.5 Flash",
  "gemini-2.5-pro":      "Gemini 2.5 Pro",
  "gemini-flash-lite-latest": "Gemini Flash Lite",
};

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { entries } = useLibrary();
  const { translationCount, readerSettings, themeMode, geminiModel } = useSettings();
  const { tokens, activeTokenId } = useTokens();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 100 + (Platform.OS === "web" ? 34 : insets.bottom);

  const reading   = entries.filter((e) => e.status === "reading").length;
  const completed = entries.filter((e) => e.status === "completed").length;
  const favorites = entries.filter((e) => e.status === "favorites").length;

  // Top genres
  const genreCounts: Record<string, number> = {};
  entries.flatMap((e) => e.manga.genres ?? []).forEach((g) => {
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });
  const topGenres = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([g]) => g);

  const activeToken = tokens.find((t) => t.id === activeTokenId);
  const availableKeys = tokens.filter((t) => !t.isRateLimited).length;

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
        <View style={[styles.avatar, { backgroundColor: colors.primary, borderColor: colors.background }]}>
          <Ionicons name="person" size={36} color="#fff" />
        </View>
        <Text style={[styles.username, { color: colors.foreground }]}>Manga Reader</Text>
        <Text style={[styles.joinDate, { color: colors.mutedForeground }]}>
          {entries.length} manga in library
        </Text>
      </LinearGradient>

      {/* Library Stats */}
      <View style={styles.statsRow}>
        <StatCard icon="library-outline"        value={entries.length} label="Library" />
        <StatCard icon="heart-outline"          value={favorites}      label="Favorites" />
        <StatCard icon="time-outline"           value={reading}        label="Reading" />
        <StatCard icon="checkmark-done-outline" value={completed}      label="Done" />
      </View>

      {/* AI Translation Card */}
      <View style={[styles.aiCard, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}28`, borderRadius: colors.radius }]}>
        <View style={styles.aiHeader}>
          <Ionicons name="sparkles" size={18} color={colors.primary} />
          <Text style={[styles.aiTitle, { color: colors.primary }]}>AI Translation</Text>
          <View style={[styles.activeKeyBadge, { backgroundColor: availableKeys > 0 ? "#22c55e20" : "#ef444420", borderColor: availableKeys > 0 ? "#22c55e40" : "#ef444440" }]}>
            <View style={[styles.activeDot, { backgroundColor: availableKeys > 0 ? "#22c55e" : "#ef4444" }]} />
            <Text style={[styles.activeKeyText, { color: availableKeys > 0 ? "#22c55e" : "#ef4444" }]}>
              {availableKeys > 0 ? `${availableKeys} key${availableKeys !== 1 ? "s" : ""} active` : "No active key"}
            </Text>
          </View>
        </View>
        <Text style={[styles.aiCount, { color: colors.foreground }]}>
          {translationCount.toLocaleString()}
        </Text>
        <Text style={[styles.aiCountLabel, { color: colors.mutedForeground }]}>total pages translated</Text>

        <View style={[styles.aiDetails, { borderTopColor: `${colors.primary}20` }]}>
          <InfoRow icon="hardware-chip-outline" label="Model" value={MODEL_LABELS[geminiModel] ?? geminiModel} />
          <InfoRow icon="globe-outline" label="Language" value={LANG_LABELS[readerSettings.targetLanguage] ?? readerSettings.targetLanguage} />
          {activeToken && (
            <InfoRow icon="key-outline" label="Active Key" value={activeToken.label || `Key #${tokens.indexOf(activeToken) + 1}`} />
          )}
        </View>
      </View>

      {/* Top Genres */}
      {topGenres.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Favorite Genres</Text>
          <View style={styles.genreRow}>
            {topGenres.map((g) => (
              <View
                key={g}
                style={[styles.genrePill, { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}35`, borderRadius: 14 }]}
              >
                <Text style={[styles.genreText, { color: colors.primary }]}>{g}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Quick info */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Reading</Text>
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <InfoRow
            icon="book-outline"
            label="Mode"
            value={readerSettings.readingMode === "vertical" ? "Vertical Scroll" : "Horizontal Pages"}
          />
          <InfoRow
            icon="arrow-forward-outline"
            label="Direction"
            value={readerSettings.readingDirection === "ltr" ? "Left to Right" : "Right to Left"}
          />
          <InfoRow
            icon="contrast-outline"
            label="Theme"
            value={themeMode.charAt(0).toUpperCase() + themeMode.slice(1)}
          />
          <InfoRow
            icon="apps-outline"
            label="Version"
            value="1.0.0"
          />
        </View>
      </View>

      {/* App Settings */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>App</Text>
        <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
          <SettingRow
            icon="settings-outline"
            label="Settings"
            onPress={() => router.push("/settings")}
          />
          <SettingRow
            icon="sparkles"
            label="AI Translation"
            value={MODEL_LABELS[geminiModel] ?? geminiModel}
            onPress={() => router.push("/settings/ai-translation" as never)}
          />
          <SettingRow
            icon="book-outline"
            label="Reader"
            value={readerSettings.readingMode === "vertical" ? "Vertical" : "Horizontal"}
            onPress={() => router.push("/settings/reader" as never)}
          />
          <SettingRow
            icon="information-circle-outline"
            label="About MangaVerse"
            onPress={() => router.push("/settings/about" as never)}
          />
        </View>
      </View>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: { alignItems: "center", paddingBottom: 24 },
  avatar: { width: 90, height: 90, borderRadius: 45, alignItems: "center", justifyContent: "center", borderWidth: 3, marginBottom: 12 },
  username: { fontSize: 22, fontWeight: "700" as const },
  joinDate: { fontSize: 13, marginTop: 4 },
  statsRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginTop: 8, marginBottom: 16 },
  statCard: { flex: 1, alignItems: "center", padding: 10, gap: 4, borderWidth: 1 },
  statValue: { fontSize: 20, fontWeight: "700" as const },
  statLabel: { fontSize: 10, textAlign: "center" as const },
  // AI card
  aiCard: { marginHorizontal: 16, marginBottom: 16, padding: 16, borderWidth: 1, gap: 2 },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  aiTitle: { fontSize: 14, fontWeight: "600" as const, flex: 1 },
  activeKeyBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activeKeyText: { fontSize: 10, fontWeight: "600" as const },
  aiCount: { fontSize: 32, fontWeight: "700" as const },
  aiCountLabel: { fontSize: 12, marginBottom: 6 },
  aiDetails: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6, paddingTop: 6, gap: 0 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { fontSize: 12, width: 80, flexShrink: 0 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: "500" as const, textAlign: "right" as const },
  // Info card (reading)
  infoCard: { borderWidth: 1, paddingHorizontal: 14, overflow: "hidden" },
  // Genre
  section: { paddingHorizontal: 16, marginBottom: 16, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "600" as const },
  genreRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  genrePill: { paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1 },
  genreText: { fontSize: 13, fontWeight: "500" as const },
  // Settings rows
  settingsCard: { borderWidth: 1, overflow: "hidden" },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingLabel: { fontSize: 15 },
  settingRight: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "45%" as never },
  settingValue: { fontSize: 13 },
});
