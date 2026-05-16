import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MangaCard } from "@/components/MangaCard";
import { useLibrary } from "@/context/LibraryContext";
import { useColors } from "@/hooks/useColors";
import { LibraryStatus } from "@/services/sources/types";

const TABS: { label: string; status: LibraryStatus | "all" }[] = [
  { label: "All", status: "all" },
  { label: "Reading", status: "reading" },
  { label: "Favorites", status: "favorites" },
  { label: "Completed", status: "completed" },
  { label: "Planned", status: "planned" },
];

export default function LibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { entries } = useLibrary();
  const [activeTab, setActiveTab] = useState<LibraryStatus | "all">("all");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 100 + (Platform.OS === "web" ? 34 : insets.bottom);

  const filtered =
    activeTab === "all"
      ? entries
      : entries.filter((e) => e.status === activeTab);

  const numColumns = 3;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My Library</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {entries.length} manga saved
        </Text>
      </View>

      {/* Tabs */}
      <FlatList
        horizontal
        data={TABS}
        keyExtractor={(item) => item.status}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
        scrollEnabled={!!TABS.length}
        renderItem={({ item }) => {
          const active = activeTab === item.status;
          const count = item.status === "all"
            ? entries.length
            : entries.filter((e) => e.status === item.status).length;
          return (
            <Pressable
              onPress={() => setActiveTab(item.status)}
              style={[
                styles.tab,
                {
                  backgroundColor: active ? colors.primary : "rgba(255,255,255,0.05)",
                  borderColor: active ? colors.primary : "rgba(255,255,255,0.1)",
                  borderRadius: 20,
                },
              ]}
            >
              <Text style={[styles.tabLabel, { color: active ? "#fff" : colors.mutedForeground }]}>
                {item.label}
              </Text>
              {count > 0 && (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: active ? "rgba(255,255,255,0.25)" : colors.muted },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: active ? "#fff" : colors.mutedForeground }]}>
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />

      {/* Grid */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.manga.id}
        numColumns={numColumns}
        key={numColumns}
        contentContainerStyle={[styles.grid, { paddingBottom: bottomPadding }]}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!filtered.length}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmarks-outline" size={56} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {activeTab === "all" ? "Your library is empty" : `No ${activeTab} manga`}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Explore and add manga to your library
            </Text>
            <Pressable
              onPress={() => router.push("/(tabs)/explore")}
              style={[styles.exploreBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            >
              <Text style={styles.exploreBtnText}>Explore Manga</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrapper}>
            <MangaCard
              manga={item.manga}
              onPress={() =>
                router.push({
                  pathname: "/manga",
                  params: { mangaId: item.manga.id, sourceId: item.manga.sourceId },
                })
              }
              size="small"
              showStatus={false}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700" as const,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  tabRow: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
    paddingBottom: 12,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    gap: 6,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600" as const,
  },
  grid: {
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  row: {
    justifyContent: "flex-start",
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  cardWrapper: {
    flex: 1,
    maxWidth: "33.33%",
    alignItems: "center",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  exploreBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 8,
  },
  exploreBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600" as const,
  },
});
