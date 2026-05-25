import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MangaCard } from "@/components/MangaCard";
import { SourceSwitcher } from "@/components/SourceSwitcher";
import SourceVerificationModal from "@/components/SourceVerificationModal";
import { useLibrary } from "@/context/LibraryContext";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";
import { getSource, SourceError } from "@/services/sources";
import { Manga } from "@/services/sources/types";

function SectionHeader({ title, onMore }: { title: string; onMore?: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <View style={[styles.sectionAccent, { backgroundColor: colors.primary }]} />
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      {onMore && (
        <Pressable onPress={onMore}>
          <Text style={[styles.moreText, { color: colors.primary }]}>See All</Text>
        </Pressable>
      )}
    </View>
  );
}

function ContinueReadingCard({ entry }: { entry: ReturnType<typeof useLibrary>["entries"][0] }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/manga",
          params: { mangaId: entry.manga.id, sourceId: entry.manga.sourceId },
        })
      }
      style={[
        styles.continueCard,
        { backgroundColor: colors.card, borderRadius: colors.radius, borderColor: colors.border },
      ]}
    >
      <Image
        source={{ uri: entry.manga.coverUrl }}
        style={[styles.continueCover, { borderRadius: 8 }]}
        contentFit="cover"
      />
      <View style={styles.continueInfo}>
        <Text style={[styles.continueTitle, { color: colors.foreground }]} numberOfLines={1}>
          {entry.manga.title}
        </Text>
        <Text style={[styles.continueChapter, { color: colors.primary }]}>
          {entry.lastChapterNum ? `Ch. ${entry.lastChapterNum}` : "Start Reading"}
        </Text>
        <Text style={[styles.continueStatus, { color: colors.mutedForeground }]}>
          {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSourceId } = useSettings();
  const { entries } = useLibrary();
  const [trending, setTrending] = useState<Manga[]>([]);
  const [latest, setLatest] = useState<Manga[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [cfSource, setCfSource] = useState<{ id: string; name: string; url: string } | null>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const loadSource = useCallback((sourceId: string) => {
    setLoading(true);
    setTrending([]);
    setLatest([]);
    setSourceError(null);
    const source = getSource(sourceId);
    Promise.all([source.getTrending(), source.getLatestUpdates()])
      .then(([t, l]) => {
        setTrending(t);
        setLatest(l);
        if (t.length === 0 && l.length === 0) {
          setSourceError(`${source.name} returned no content. The source may be temporarily unavailable.`);
        }
      })
      .catch((err) => {
        if (err instanceof SourceError) {
          if (err.type === "cloudflare") {
            const src = getSource(sourceId);
            setCfSource({ id: sourceId, name: src.name, url: src.baseUrl });
          } else {
            setSourceError(err.message);
          }
        } else if (err instanceof Error) {
          setSourceError(err.message);
        } else {
          setSourceError("Failed to load from this source. Try switching sources.");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSource(activeSourceId);
  }, [activeSourceId, loadSource]);

  const reading = entries.filter((e) => e.status === "reading").slice(0, 5);

  const navigateToManga = (manga: Manga) => {
    router.push({
      pathname: "/manga",
      params: { mangaId: manga.id, sourceId: manga.sourceId },
    });
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: 100 + (Platform.OS === "web" ? 34 : insets.bottom) }}
      showsVerticalScrollIndicator={false}
    >
      {/* CF Verification modal */}
      {cfSource && (
        <SourceVerificationModal
          visible
          sourceId={cfSource.id}
          sourceName={cfSource.name}
          sourceUrl={cfSource.url}
          onVerified={() => {
            setCfSource(null);
            loadSource(activeSourceId);
          }}
          onDismiss={() => setCfSource(null)}
          onChangeSource={() => setCfSource(null)}
        />
      )}

      {/* Source error banner */}
      {sourceError && !loading && (
        <View style={[styles.errorBanner, { backgroundColor: "#1c1917", borderColor: "rgba(239,68,68,0.35)" }]}>
          <Ionicons name="warning-outline" size={15} color="#ef4444" />
          <Text style={[styles.errorBannerText, { color: "#d1d5db" }]} numberOfLines={2}>
            {sourceError}
          </Text>
          <Pressable onPress={() => { setSourceError(null); loadSource(activeSourceId); }}>
            <Ionicons name="refresh" size={15} color={colors.primary} />
          </Pressable>
        </View>
      )}

      {/* Header */}
      <LinearGradient
        colors={[`${colors.primary}22`, "transparent"]}
        style={[styles.header, { paddingTop: topPadding + 12 }]}
      >
        <View style={styles.headerContent}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.primary }]}>
              MANGAVERSE
            </Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Your universe of stories
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/settings")}
            style={styles.headerIcon}
          >
            <Ionicons name="settings-outline" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <SourceSwitcher />
      </LinearGradient>

      {/* Continue Reading */}
      {reading.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Continue Reading" />
          {reading.map((entry) => (
            <ContinueReadingCard key={entry.manga.id} entry={entry} />
          ))}
        </View>
      )}

      {/* Trending */}
      <View style={styles.section}>
        <SectionHeader
          title="Trending Now"
          onMore={() => router.push("/(tabs)/explore")}
        />
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={trending.slice(0, 10)}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.horizontalList}
            scrollEnabled={trending.length > 0}
            renderItem={({ item }) => (
              <MangaCard
                manga={item}
                onPress={() => navigateToManga(item)}
                size="large"
              />
            )}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
          />
        )}
      </View>

      {/* Latest Updates */}
      <View style={styles.section}>
        <SectionHeader
          title="Latest Updates"
          onMore={() => router.push("/(tabs)/explore")}
        />
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={latest.slice(0, 10)}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.horizontalList}
            scrollEnabled={latest.length > 0}
            renderItem={({ item }) => (
              <MangaCard
                manga={item}
                onPress={() => navigateToManga(item)}
                size="medium"
              />
            )}
            ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
          />
        )}
      </View>

      {/* Popular Categories */}
      <View style={styles.section}>
        <SectionHeader title="Browse by Genre" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genreList}>
          {["Action", "Romance", "Fantasy", "Isekai", "Horror", "Comedy", "Sci-Fi", "Mystery"].map(
            (genre) => (
              <Pressable
                key={genre}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/explore",
                    params: { genre },
                  })
                }
                style={[
                  styles.genrePill,
                  { borderColor: colors.border, backgroundColor: colors.card, borderRadius: 20 },
                ]}
              >
                <Text style={[styles.genreText, { color: colors.foreground }]}>{genre}</Text>
              </Pressable>
            )
          )}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingBottom: 4,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  headerIcon: {
    padding: 8,
  },
  section: {
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionAccent: {
    width: 3,
    height: 18,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
  },
  moreText: {
    fontSize: 13,
  },
  horizontalList: {
    paddingHorizontal: 16,
  },
  loadingRow: {
    height: 200,
    justifyContent: "center",
    alignItems: "center",
  },
  continueCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    gap: 12,
  },
  continueCover: {
    width: 50,
    height: 70,
  },
  continueInfo: {
    flex: 1,
    gap: 3,
  },
  continueTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  continueChapter: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  continueStatus: {
    fontSize: 11,
  },
  genreList: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
  },
  genrePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
});
