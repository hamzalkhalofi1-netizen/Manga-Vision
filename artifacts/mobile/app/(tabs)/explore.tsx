import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MangaCard } from "@/components/MangaCard";
import { SourceSwitcher } from "@/components/SourceSwitcher";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";
import { getSource } from "@/services/sources";
import { Manga } from "@/services/sources/types";

const GENRES = [
  "All", "Action", "Adventure", "Comedy", "Drama", "Fantasy",
  "Horror", "Isekai", "Mystery", "Romance", "Sci-Fi", "Slice of Life",
];

export default function ExploreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ genre?: string }>();
  const { activeSourceId } = useSettings();

  const [query, setQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState(params.genre ?? "All");
  const [results, setResults] = useState<Manga[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const doSearch = useCallback(
    async (q: string, pageNum: number, reset = false) => {
      const source = getSource(activeSourceId);
      setLoading(true);
      try {
        let data: Manga[];
        if (q.trim()) {
          data = await source.search(q.trim(), pageNum);
        } else {
          data = await source.getTrending(pageNum);
        }
        if (reset) {
          setResults(data);
        } else {
          setResults((prev) => [...prev, ...data]);
        }
        setHasMore(data.length === 20);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [activeSourceId]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      doSearch(query, 0, true);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, activeSourceId, doSearch]);

  const loadMore = () => {
    if (!loading && hasMore) {
      const next = page + 1;
      setPage(next);
      doSearch(query, next);
    }
  };

  const numColumns = 3;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
          ]}
        >
          <Ionicons name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search manga, manhwa, webtoon..."
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <SourceSwitcher />
      </View>

      {/* Genre Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.genreRow}
      >
        {GENRES.map((g) => {
          const active = g === activeGenre;
          return (
            <Pressable
              key={g}
              onPress={() => setActiveGenre(g)}
              style={[
                styles.genrePill,
                {
                  backgroundColor: active ? colors.primary : "rgba(255,255,255,0.05)",
                  borderColor: active ? colors.primary : "rgba(255,255,255,0.1)",
                  borderRadius: 16,
                },
              ]}
            >
              <Text
                style={[
                  styles.genreText,
                  { color: active ? "#fff" : colors.mutedForeground },
                ]}
              >
                {g}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Results */}
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        key={numColumns}
        contentContainerStyle={[
          styles.grid,
          { paddingBottom: 100 + (Platform.OS === "web" ? 34 : insets.bottom) },
        ]}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        scrollEnabled={!!results.length}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <View style={styles.center}>
              <Ionicons name="search-outline" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {query ? "No results found" : "Discover manga"}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loading && results.length > 0 ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.cardWrapper}>
            <MangaCard
              manga={item}
              onPress={() =>
                router.push({
                  pathname: "/manga",
                  params: { mangaId: item.id, sourceId: item.sourceId },
                })
              }
              size="small"
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
    gap: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: 44,
  },
  genreRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: "row",
  },
  genrePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 12,
    fontWeight: "500" as const,
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
  },
  footer: {
    padding: 20,
    alignItems: "center",
  },
});
