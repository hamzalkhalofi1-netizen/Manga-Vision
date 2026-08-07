import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/context/SettingsContext";
import { useLibrary } from "@/context/LibraryContext";
import { SettingsSection, SettingsItem, SettingsToggle } from "@/components/settings";

function ActionCard({
  icon,
  label,
  desc,
  onPress,
  loading,
  danger,
}: {
  icon: string;
  label: string;
  desc: string;
  onPress: () => void;
  loading?: boolean;
  danger?: boolean;
}) {
  const colors = useColors();
  const color = danger ? colors.destructive : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.actionCard,
        {
          backgroundColor: pressed ? `${color}12` : `${color}08`,
          borderColor: `${color}25`,
          borderRadius: colors.radius,
          opacity: loading ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: `${color}18` }]}>
        {loading ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Ionicons name={icon as never} size={20} color={color} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.actionLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.actionDesc, { color: colors.mutedForeground }]}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function BackupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { readerSettings, fontSettings, networkSettings, translationSettings, themeMode, geminiModel } = useSettings();
  const { entries } = useLibrary();

  const [exporting, setExporting] = useState<string | null>(null);
  const [autoBackup, setAutoBackup] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  const handleExportSettings = async () => {
    setExporting("settings");
    try {
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        settings: { readerSettings, fontSettings, networkSettings, translationSettings, themeMode, geminiModel },
      };
      const json = JSON.stringify(payload, null, 2);
      await Share.share({
        message: json,
        title: "MangaVerse Settings",
      });
    } catch (e) {
      Alert.alert("Export Failed", "Could not export settings.");
    } finally {
      setExporting(null);
    }
  };

  const handleExportLibrary = async () => {
    setExporting("library");
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        library: entries,
      };
      await Share.share({
        message: JSON.stringify(payload, null, 2),
        title: "MangaVerse Library",
      });
    } catch {
      Alert.alert("Export Failed", "Could not export library.");
    } finally {
      setExporting(null);
    }
  };

  const handleExportTokens = async () => {
    Alert.alert(
      "Export API Keys",
      "⚠️ Your API keys will be included in plain text. Only share this with yourself in a secure location.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Export Anyway",
          style: "destructive",
          onPress: async () => {
            setExporting("tokens");
            try {
              const raw = await AsyncStorage.getItem("mangaverse_gemini_tokens_v3");
              await Share.share({
                message: raw ?? "[]",
                title: "MangaVerse API Keys",
              });
            } catch {
              Alert.alert("Export Failed", "Could not export API keys.");
            } finally {
              setExporting(null);
            }
          },
        },
      ]
    );
  };

  const handleImportSettings = () => {
    Alert.alert(
      "Import Settings",
      "Paste your exported settings JSON to restore your configuration.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open Import",
          onPress: () => {
            Alert.alert(
              "Coming Soon",
              "Settings import via clipboard will be available in the next update.",
              [{ text: "OK" }]
            );
          },
        },
      ]
    );
  };

  const handleRestoreLibrary = () => {
    Alert.alert(
      "Restore Library",
      "This feature is coming soon. Library merge and conflict resolution will be supported.",
      [{ text: "OK" }]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Backup & Restore</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* Info banner */}
        <View style={[styles.infoBanner, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}25` }]}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Exports create JSON files you can save, share, or import later. Your data stays on your device.
          </Text>
        </View>

        {/* Export */}
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>EXPORT</Text>
          <ActionCard
            icon="settings-outline"
            label="Export Settings"
            desc="Reader, fonts, network, translation config"
            onPress={handleExportSettings}
            loading={exporting === "settings"}
          />
          <ActionCard
            icon="library-outline"
            label="Export Library"
            desc={`${entries.length} manga with reading progress`}
            onPress={handleExportLibrary}
            loading={exporting === "library"}
          />
          <ActionCard
            icon="key-outline"
            label="Export API Keys"
            desc="Gemini API keys — handle with care"
            onPress={handleExportTokens}
            loading={exporting === "tokens"}
            danger
          />
        </View>

        <View style={{ height: 20 }} />

        {/* Import */}
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>IMPORT</Text>
          <ActionCard
            icon="download-outline"
            label="Import Settings"
            desc="Restore from a previously exported JSON"
            onPress={handleImportSettings}
          />
          <ActionCard
            icon="albums-outline"
            label="Restore Library"
            desc="Merge imported library with current one"
            onPress={handleRestoreLibrary}
          />
        </View>

        <View style={{ height: 20 }} />

        {/* Auto backup */}
        <SettingsSection
          title="Automatic Backup"
          icon="cloud-upload-outline"
          defaultExpanded={false}
          subtitle="Google Drive ready — coming soon"
        >
          <SettingsItem
            icon="cloud-outline"
            label="Auto Backup"
            description="Backup settings automatically (Google Drive)"
            noChevron
            last
            right={
              <SettingsToggle
                value={autoBackup}
                onValueChange={setAutoBackup}
                disabled
              />
            }
          />
        </SettingsSection>

        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Google Drive backup is planned for a future release.
        </Text>
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
  infoBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  infoText: { flex: 1, fontSize: 12, lineHeight: 18 },
  sectionLabel: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.8, paddingHorizontal: 4 },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderWidth: 1,
  },
  actionIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  actionLabel: { fontSize: 15, fontWeight: "500" as const },
  actionDesc: { fontSize: 12, lineHeight: 16 },
  note: { fontSize: 11, textAlign: "center", marginHorizontal: 24, marginTop: 16 },
});
