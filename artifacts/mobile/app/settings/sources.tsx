import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SourceRegistry } from "@/services/sources/SourceRegistry";
import { SettingsToggle } from "@/components/settings";

// ── Source card ───────────────────────────────────────────────────────────────

function SourceCard({ sourceId }: { sourceId: string }) {
  const colors = useColors();
  const source = SourceRegistry.get(sourceId);
  const meta = SourceRegistry.getMeta(sourceId);
  const caps = SourceRegistry.getCapabilities(sourceId);
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(meta?.isEnabled ?? true);
  const [testing, setTesting] = useState(false);

  if (!source || !meta) return null;

  const handleToggleEnabled = (value: boolean) => {
    setEnabled(value);
    SourceRegistry.setEnabled(sourceId, value);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await source.getTrending?.(1);
      Alert.alert(
        "Source Test",
        result && result.length > 0
          ? `✅ ${source.name} is working\n${result.length} items returned`
          : `⚠️ ${source.name} returned no results`,
        [{ text: "OK" }]
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Source Test Failed", `❌ ${source.name}\n${msg}`, [{ text: "OK" }]);
    } finally {
      setTesting(false);
    }
  };

  const langLabel = Array.isArray(meta.language)
    ? meta.language.join(", ").toUpperCase()
    : meta.language.toUpperCase();

  return (
    <View style={[styles.sourceCard, { backgroundColor: colors.card, borderColor: enabled ? colors.border : `${colors.border}60`, borderRadius: colors.radius }]}>
      {/* Header row */}
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        style={[styles.sourceHeader, { opacity: enabled ? 1 : 0.55 }]}
      >
        <View style={[styles.sourceIconWrap, { backgroundColor: `${colors.primary}18` }]}>
          <Ionicons name="server-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.sourceInfo}>
          <View style={styles.sourceNameRow}>
            <Text style={[styles.sourceName, { color: colors.foreground }]}>{source.name}</Text>
            {meta.hasOfficialApi && (
              <View style={[styles.tag, { backgroundColor: `${colors.primary}20` }]}>
                <Text style={[styles.tagText, { color: colors.primary }]}>API</Text>
              </View>
            )}
            {meta.requiresVerification && (
              <View style={[styles.tag, { backgroundColor: "#f59e0b20" }]}>
                <Text style={[styles.tagText, { color: "#f59e0b" }]}>CF</Text>
              </View>
            )}
            {meta.nsfw && (
              <View style={[styles.tag, { backgroundColor: "#ef444420" }]}>
                <Text style={[styles.tagText, { color: "#ef4444" }]}>18+</Text>
              </View>
            )}
          </View>
          <Text style={[styles.sourceMeta, { color: colors.mutedForeground }]}>
            {langLabel} · v{meta.version ?? "1.0.0"}
            {meta.websiteUrl ? ` · ${meta.websiteUrl.replace(/^https?:\/\//, "").split("/")[0]}` : ""}
          </Text>
        </View>
        <SettingsToggle value={enabled} onValueChange={handleToggleEnabled} />
      </Pressable>

      {/* Expanded detail */}
      {expanded && (
        <View style={[styles.sourceDetail, { borderTopColor: colors.border }]}>
          {/* Capabilities */}
          <View style={styles.capsRow}>
            {caps.search && (
              <View style={[styles.cap, { backgroundColor: `${colors.primary}15` }]}>
                <Ionicons name="search-outline" size={10} color={colors.primary} />
                <Text style={[styles.capText, { color: colors.primary }]}>Search</Text>
              </View>
            )}
            {caps.trending && (
              <View style={[styles.cap, { backgroundColor: `${colors.primary}15` }]}>
                <Ionicons name="trending-up-outline" size={10} color={colors.primary} />
                <Text style={[styles.capText, { color: colors.primary }]}>Trending</Text>
              </View>
            )}
            {caps.latestUpdates && (
              <View style={[styles.cap, { backgroundColor: `${colors.primary}15` }]}>
                <Ionicons name="time-outline" size={10} color={colors.primary} />
                <Text style={[styles.capText, { color: colors.primary }]}>Latest</Text>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <Pressable
              onPress={handleTest}
              disabled={testing || !enabled}
              style={[
                styles.actionBtn,
                {
                  backgroundColor: `${colors.primary}15`,
                  borderColor: `${colors.primary}30`,
                  opacity: (!enabled || testing) ? 0.5 : 1,
                },
              ]}
            >
              {testing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="pulse-outline" size={14} color={colors.primary} />
              )}
              <Text style={[styles.actionText, { color: colors.primary }]}>Test</Text>
            </Pressable>

            {meta.websiteUrl && (
              <Pressable
                style={[styles.actionBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
              >
                <Ionicons name="open-outline" size={14} color={colors.mutedForeground} />
                <Text style={[styles.actionText, { color: colors.mutedForeground }]}>Website</Text>
              </Pressable>
            )}
          </View>

          {meta.requiresVerification && (
            <View style={[styles.cfBanner, { backgroundColor: "#f59e0b15", borderColor: "#f59e0b30" }]}>
              <Ionicons name="shield-outline" size={14} color="#f59e0b" />
              <Text style={[styles.cfText, { color: "#f59e0b" }]}>
                Requires Cloudflare verification. Open a chapter to complete the challenge.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SourcesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [refreshKey, setRefreshKey] = useState(0);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  const sourceIds = useMemo(() => SourceRegistry.getIds(), [refreshKey]);
  const enabledCount = useMemo(
    () => sourceIds.filter((id) => SourceRegistry.getMeta(id)?.isEnabled).length,
    [sourceIds, refreshKey]
  );

  const handleRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Sources</Text>
        <Pressable onPress={handleRefresh} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPadding, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary */}
        <View style={[styles.summaryCard, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}25` }]}>
          <Ionicons name="server-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.summaryTitle, { color: colors.foreground }]}>
              {enabledCount}/{sourceIds.length} Sources Active
            </Text>
            <Text style={[styles.summaryDesc, { color: colors.mutedForeground }]}>
              Tap a source to expand options · toggle to enable/disable
            </Text>
          </View>
        </View>

        {sourceIds.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="server-outline" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No sources registered yet.{"\n"}Navigate to the Home screen to load sources.
            </Text>
          </View>
        ) : (
          <View style={styles.sourceList}>
            {sourceIds.map((id) => (
              <SourceCard key={`${id}-${refreshKey}`} sourceId={id} />
            ))}
          </View>
        )}

        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Source priority follows the order above. Drag to reorder (coming soon).
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
  refreshBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "600" as const },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  summaryTitle: { fontSize: 14, fontWeight: "600" as const },
  summaryDesc: { fontSize: 12, marginTop: 2 },
  sourceList: { paddingHorizontal: 16, gap: 10 },
  sourceCard: { borderWidth: 1, overflow: "hidden" },
  sourceHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  sourceIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sourceInfo: { flex: 1, gap: 3 },
  sourceNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  sourceName: { fontSize: 15, fontWeight: "600" as const },
  sourceMeta: { fontSize: 11 },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  tagText: { fontSize: 9, fontWeight: "700" as const },
  sourceDetail: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  capsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  cap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  capText: { fontSize: 10, fontWeight: "600" as const },
  actionsRow: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionText: { fontSize: 12, fontWeight: "600" as const },
  cfBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
  cfText: { fontSize: 11, lineHeight: 16, flex: 1 },
  emptyState: { alignItems: "center", gap: 12, padding: 40 },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  note: { fontSize: 11, textAlign: "center", marginHorizontal: 24, marginTop: 16 },
});
