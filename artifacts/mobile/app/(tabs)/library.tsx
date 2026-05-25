import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MangaCard } from "@/components/MangaCard";
import { useDownloads } from "@/context/DownloadContext";
import { useLibrary } from "@/context/LibraryContext";
import { useColors } from "@/hooks/useColors";
import { DownloadRecord } from "@/services/downloadManager";
import { LibraryStatus } from "@/services/sources/types";

type TabKey = LibraryStatus | "all" | "downloaded";

const TABS: { label: string; key: TabKey }[] = [
  { label: "All", key: "all" },
  { label: "Reading", key: "reading" },
  { label: "Favorites", key: "favorites" },
  { label: "Completed", key: "completed" },
  { label: "Planned", key: "planned" },
  { label: "Downloaded", key: "downloaded" },
];

function groupByManga(records: DownloadRecord[]): { mangaId: string; mangaTitle: string; coverUrl: string; chapters: DownloadRecord[] }[] {
  const map = new Map<string, { mangaId: string; mangaTitle: string; coverUrl: string; chapters: DownloadRecord[] }>();
  for (const r of records) {
    if (!map.has(r.mangaId)) {
      map.set(r.mangaId, { mangaId: r.mangaId, mangaTitle: r.mangaTitle, coverUrl: r.coverUrl, chapters: [] });
    }
    map.get(r.mangaId)!.chapters.push(r);
  }
  return Array.from(map.values()).map((g) => ({
    ...g,
    chapters: [...g.chapters].sort((a, b) => parseFloat(a.chapterNum) - parseFloat(b.chapterNum)),
  }));
}

export default function LibraryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { entries } = useLibrary();
  const { downloads, deleteChapter } = useDownloads();
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 100 + (Platform.OS === "web" ? 34 : insets.bottom);

  const filtered =
    activeTab === "all"
      ? entries
      : activeTab === "downloaded"
      ? []
      : entries.filter((e) => e.status === activeTab);

  const numColumns = 3;
  const downloadGroups = groupByManga(downloads);

  const handleDeleteChapter = (r: DownloadRecord) => {
    Alert.alert(
      "Remove Download",
      `Delete the offline copy of Chapter ${r.chapterNum} of "${r.mangaTitle}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteChapter(r.sourceId, r.mangaId, r.chapterId),
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My Library</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {entries.length} manga saved
          {downloads.length > 0 ? ` · ${downloads.length} chapters offline` : ""}
        </Text>
      </View>

      {/* Tabs */}
      <FlatList
        horizontal
        data={TABS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
        scrollEnabled={!!TABS.length}
        renderItem={({ item }) => {
          const active = activeTab === item.key;
          const count =
            item.key === "all"
              ? entries.length
              : item.key === "downloaded"
              ? downloads.length
              : entries.filter((e) => e.status === item.key).length;
          return (
            <Pressable
              onPress={() => setActiveTab(item.key)}
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

      {/* Downloaded tab content */}
      {activeTab === "downloaded" ? (
        <FlatList
          data={downloadGroups}
          keyExtractor={(item) => item.mangaId}
          contentContainerStyle={[styles.dlList, { paddingBottom: bottomPadding }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            Platform.OS === "web" ? (
              <View style={styles.empty}>
                <Ionicons name="phone-portrait-outline" size={52} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  Downloads on mobile only
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Open MangaVerse on your phone or tablet to save chapters for offline reading.
                </Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="cloud-download-outline" size={56} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No offline chapters
                </Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Open a chapter in the reader and tap the download button to save it for offline reading.
                </Text>
              </View>
            )
          }
          renderItem={({ item: group }) => (
            <View style={[styles.dlGroup, { backgroundColor: colors.card, borderRadius: colors.radius }]}>
              <View style={styles.dlGroupHeader}>
                {group.coverUrl ? (
                  <Image
                    source={{ uri: group.coverUrl }}
                    style={styles.dlGroupCover}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.dlGroupCover, { backgroundColor: colors.muted }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dlGroupTitle, { color: colors.foreground }]} numberOfLines={2}>
                    {group.mangaTitle}
                  </Text>
                  <Text style={[styles.dlGroupSub, { color: colors.mutedForeground }]}>
                    {group.chapters.length} chapter{group.chapters.length !== 1 ? "s" : ""} downloaded
                  </Text>
                </View>
              </View>
              {group.chapters.map((ch) => (
                <Pressable
                  key={ch.chapterId}
                  style={[styles.dlChapterRow, { borderTopColor: colors.border }]}
                  onPress={() =>
                    router.push({
                      pathname: "/reader",
                      params: {
                        mangaId: ch.mangaId,
                        chapterId: ch.chapterId,
                        chapterNum: ch.chapterNum,
                        mangaTitle: ch.mangaTitle,
                        sourceId: ch.sourceId,
                      },
                    })
                  }
                >
                  <Ionicons name="book-outline" size={16} color={colors.primary} style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dlChapterTitle, { color: colors.foreground }]}>
                      Chapter {ch.chapterNum}
                    </Text>
                    <Text style={[styles.dlChapterMeta, { color: colors.mutedForeground }]}>
                      {ch.pageCount} pages · saved {new Date(ch.downloadedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleDeleteChapter(ch)}
                    style={styles.dlDeleteBtn}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.mutedForeground} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}
        />
      ) : (
        /* Library manga grid */
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
      )}
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
  dlList: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  dlGroup: {
    overflow: "hidden",
    marginBottom: 4,
  },
  dlGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  dlGroupCover: {
    width: 48,
    height: 64,
    borderRadius: 6,
  },
  dlGroupTitle: {
    fontSize: 15,
    fontWeight: "700" as const,
    lineHeight: 20,
  },
  dlGroupSub: {
    fontSize: 12,
    marginTop: 2,
  },
  dlChapterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  dlChapterTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  dlChapterMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  dlDeleteBtn: {
    padding: 4,
  },
});
