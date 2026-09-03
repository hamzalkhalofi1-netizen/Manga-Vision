import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/context/SettingsContext";
import {
  getSettingsAuditEntries,
  getSettingsAuditSummary,
} from "@/services/settingsAudit";

export default function SettingsDebugScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    settingsReady,
    settingsLastUpdated,
    readerSettings,
    fontSettings,
    networkSettings,
    translationSettings,
    imageProcessingSettings,
    themeMode,
    geminiModel,
  } = useSettings();
  const summary = getSettingsAuditSummary();
  const entries = getSettingsAuditEntries({
    ...readerSettings,
    ...fontSettings,
    ...networkSettings,
    ...translationSettings,
    ...imageProcessingSettings,
    themeMode,
    geminiModel,
  });
  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings Debug</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
            {settingsReady ? "Settings loaded" : "Loading persisted settings"}
          </Text>
          <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
            {summary.connected} connected · {summary.partial} partial · {summary.unused} unused
          </Text>
        </View>
        {entries.map((entry) => {
          const color = entry.status === "connected" ? "#22c55e" : entry.status === "partial" ? "#f59e0b" : "#ef4444";
          const updated = settingsLastUpdated[entry.groupKey];
          return (
            <View key={entry.id} style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <View style={styles.rowText}>
                <Text style={[styles.label, { color: colors.foreground }]}>{entry.label}</Text>
                <Text style={[styles.value, { color: colors.foreground }]}>
                  Current value: {JSON.stringify(entry.currentValue)}
                </Text>
                <Text style={[styles.consumer, { color: colors.mutedForeground }]}>{entry.consumer}</Text>
                <Text style={[styles.updated, { color: colors.mutedForeground }]}>
                  Source: SettingsContext + AsyncStorage · Last updated: {updated ? "this session" : "startup/default"}
                </Text>
              </View>
              <Text style={[styles.status, { color }]}>{entry.status}</Text>
            </View>
          );
        })}
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
  content: { padding: 16, paddingBottom: 40 },
  summary: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  summaryTitle: { fontSize: 15, fontWeight: "600" as const },
  summaryText: { fontSize: 12, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: "600" as const },
  value: { fontSize: 12, marginTop: 1 },
  consumer: { fontSize: 12, lineHeight: 17 },
  updated: { fontSize: 10, marginTop: 2 },
  status: { fontSize: 10, fontWeight: "700" as const, textTransform: "uppercase" },
});