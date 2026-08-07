import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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
import { clearTranslationCache, getTranslationCacheSize } from "@/services/translationQueue";

interface StorageItem {
  key: string;
  icon: string;
  label: string;
  desc: string;
  bytes: number;
  onClear?: () => Promise<void>;
  accent?: boolean;
}

function StorageBar({ ratio, color }: { ratio: number; color: string }) {
  const colors = useColors();
  return (
    <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
      <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, ratio * 100))}%`, backgroundColor: color }]} />
    </View>
  );
}

function StorageCard({
  item,
  totalBytes,
  onClearDone,
}: {
  item: StorageItem;
  totalBytes: number;
  onClearDone: () => void;
}) {
  const colors = useColors();
  const [clearing, setClearing] = useState(false);

  const ratio = totalBytes > 0 ? item.bytes / totalBytes : 0;
  const color = item.accent ? colors.primary : colors.mutedForeground;

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleClear = async () => {
    if (!item.onClear) return;
    Alert.alert(
      `Clear ${item.label}`,
      `This will permanently delete all ${item.label.toLowerCase()} data. Continue?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setClearing(true);
            await item.onClear!();
            setClearing(false);
            onClearDone();
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.storageCard, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
      <View style={styles.storageCardRow}>
        <View style={[styles.storageIcon, { backgroundColor: `${color}18` }]}>
          <Ionicons name={item.icon as never} size={18} color={color} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.storageLabel, { color: colors.foreground }]}>{item.label}</Text>
          <Text style={[styles.storageDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={[styles.storageSize, { color: item.bytes > 0 ? colors.foreground : colors.mutedForeground }]}>
            {formatBytes(item.bytes)}
          </Text>
          {item.onClear && item.bytes > 0 && (
            <Pressable
              onPress={handleClear}
              disabled={clearing}
              style={[styles.clearBtn, { borderColor: colors.destructive, opacity: clearing ? 0.5 : 1 }]}
            >
              {clearing ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <Text style={[styles.clearBtnText, { color: colors.destructive }]}>Clear</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
      <StorageBar ratio={ratio} color={color} />
    </View>
  );
}

export default function StorageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [cachePages, setCachePages] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clearingAll, setClearingAll] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  useEffect(() => {
    setCachePages(getTranslationCacheSize());
  }, [refreshKey]);

  const onClearDone = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Estimate bytes (translation cache = ~200KB per page on average)
  const translationBytes = cachePages * 200_000;
  const dbBytes = 48_000; // approximate AsyncStorage usage
  const cookieBytes = 12_000;
  const tempBytes = 4_000;

  const totalBytes = translationBytes + dbBytes + cookieBytes + tempBytes;

  const ITEMS: StorageItem[] = [
    {
      key: "translation",
      icon: "language-outline",
      label: "Translation Cache",
      desc: `${cachePages} page${cachePages !== 1 ? "s" : ""} cached`,
      bytes: translationBytes,
      accent: true,
      onClear: async () => {
        await clearTranslationCache();
        setCachePages(0);
      },
    },
    {
      key: "db",
      icon: "server-outline",
      label: "Database",
      desc: "Library, reading progress, tokens",
      bytes: dbBytes,
    },
    {
      key: "cookies",
      icon: "shield-outline",
      label: "Cookies",
      desc: "Source authentication cookies",
      bytes: cookieBytes,
    },
    {
      key: "temp",
      icon: "document-outline",
      label: "Temporary Files",
      desc: "Build artifacts and logs",
      bytes: tempBytes,
    },
  ];

  const formatTotal = (b: number) => {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleClearAll = () => {
    Alert.alert(
      "Clear Everything",
      "This will delete ALL cached data including translations, cookies, and temporary files. Your library and settings will be preserved.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            setClearingAll(true);
            await clearTranslationCache();
            setCachePages(0);
            setRefreshKey((k) => k + 1);
            setClearingAll(false);
            Alert.alert("Done", "All cached data has been cleared.");
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Storage</Text>
        <Pressable onPress={onClearDone} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* Total summary */}
        <View style={[styles.totalCard, { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}25` }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>TOTAL USED</Text>
            <Text style={[styles.totalValue, { color: colors.foreground }]}>{formatTotal(totalBytes)}</Text>
          </View>
          <Ionicons name="archive-outline" size={32} color={`${colors.primary}60`} />
        </View>

        {/* Storage items */}
        <View style={{ paddingHorizontal: 16, gap: 10, marginTop: 6 }}>
          {ITEMS.map((item) => (
            <StorageCard
              key={item.key}
              item={item}
              totalBytes={totalBytes}
              onClearDone={onClearDone}
            />
          ))}
        </View>

        {/* Clear all */}
        <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
          <Pressable
            onPress={handleClearAll}
            disabled={clearingAll}
            style={[styles.clearAllBtn, { borderColor: colors.destructive, opacity: clearingAll ? 0.6 : 1 }]}
          >
            {clearingAll ? (
              <ActivityIndicator size="small" color={colors.destructive} />
            ) : (
              <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            )}
            <Text style={[styles.clearAllText, { color: colors.destructive }]}>Clear Everything</Text>
          </Pressable>
          <Text style={[styles.clearNote, { color: colors.mutedForeground }]}>
            Library, settings, and reading history will not be affected.
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
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  refreshBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "600" as const },
  totalCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 18,
    borderWidth: 1,
    borderRadius: 14,
  },
  totalLabel: { fontSize: 10, fontWeight: "600" as const, letterSpacing: 0.6 },
  totalValue: { fontSize: 32, fontWeight: "700" as const, marginTop: 2 },
  storageCard: { borderWidth: 1, padding: 14, gap: 10 },
  storageCardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  storageIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  storageLabel: { fontSize: 14, fontWeight: "500" as const },
  storageDesc: { fontSize: 11 },
  storageSize: { fontSize: 14, fontWeight: "600" as const },
  clearBtn: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, minWidth: 50, alignItems: "center" },
  clearBtnText: { fontSize: 11, fontWeight: "600" as const },
  barTrack: { height: 4, borderRadius: 2 },
  barFill: { height: 4, borderRadius: 2 },
  clearAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderWidth: 1,
    borderRadius: 10,
  },
  clearAllText: { fontSize: 14, fontWeight: "600" as const },
  clearNote: { fontSize: 11, textAlign: "center", marginTop: 8, lineHeight: 16 },
});
