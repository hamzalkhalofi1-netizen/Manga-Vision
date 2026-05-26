import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { ChapterItem } from "@/components/ChapterItem";
import { useLibrary } from "@/context/LibraryContext";
import { useSettings } from "@/context/SettingsContext";
import { useTokens } from "@/context/TokenContext";
import { useColors } from "@/hooks/useColors";
import SourceVerificationModal from "@/components/SourceVerificationModal";
import { SourceErrorView } from "@/components/SourceErrorView";
import { getSource, SourceError } from "@/services/sources";
import type { SourceErrorType } from "@/services/sources";
import { Chapter, LibraryStatus, Manga } from "@/services/sources/types";

const STATUS_ICONS: Record<LibraryStatus, string> = {
  reading: "book",
  completed: "checkmark-done",
  planned: "time",
  favorites: "heart",
};

export default function MangaScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mangaId: string; sourceId: string }>();
  const { addToLibrary, removeFromLibrary, isInLibrary, getEntry, getProgress } = useLibrary();
  const { readerSettings, activeSourceId, incrementTranslationCount } = useSettings();
  const { getActiveKey, markRateLimited, activeTokenId } = useTokens();

  const [manga, setManga] = useState<Manga | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [translatedDesc, setTranslatedDesc] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [sourceErr, setSourceErr] = useState<{ type: SourceErrorType; message: string } | null>(null);
  const [verifyVisible, setVerifyVisible] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const sourceId = params.sourceId || activeSourceId;
  const mangaId = params.mangaId;

  useEffect(() => {
    if (!mangaId) return;
    const source = getSource(sourceId);
    setLoading(true);
    setSourceErr(null);
    Promise.all([source.getMangaDetails(mangaId), source.getChapters(mangaId)])
      .then(([m, c]) => {
        setManga(m);
        setChapters(c);
      })
      .catch((err) => {
        console.error("[manga] load failed:", err);
        if (err instanceof SourceError) {
          setSourceErr({ type: err.type, message: err.message });
          if (err.type === "cloudflare" || err.type === "auth") {
            const src = getSource(sourceId);
            if (src.requiresVerification) setVerifyVisible(true);
          }
        } else {
          setSourceErr({ type: "network", message: err instanceof Error ? err.message : "Failed to load manga." });
        }
      })
      .finally(() => setLoading(false));
  }, [mangaId, sourceId, retryKey]);

  const entry = mangaId ? getEntry(mangaId) : undefined;
  const progress = mangaId ? getProgress(mangaId) : undefined;
  const inLib = mangaId ? isInLibrary(mangaId) : false;

  const handleAddToLibrary = (status: LibraryStatus) => {
    if (!manga) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addToLibrary(manga, status);
    Alert.alert("Added to Library", `"${manga.title}" added to ${status}`);
  };

  const handleRemove = () => {
    if (!manga || !mangaId) return;
    Alert.alert("Remove from Library", `Remove "${manga.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          removeFromLibrary(mangaId);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        },
      },
    ]);
  };

  const handleTranslate = async () => {
    if (!manga?.description) return;
    setTranslating(true);
    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const userKey = getActiveKey();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userKey) headers["X-Gemini-Key"] = userKey;

      const res = await fetch(`https://${domain}/api/translate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: manga.description,
          targetLanguage: readerSettings.targetLanguage,
          context: `Manga/manhwa description for: ${manga.title}. Genre: ${manga.genres?.join(", ")}`,
        }),
      });
      if (res.status === 429) {
        if (activeTokenId) markRateLimited(activeTokenId, 70_000);
        Alert.alert("Rate Limited", "This API key hit its limit. Add another key in Settings.");
        return;
      }
      if (!res.ok) throw new Error("Translation failed");
      const data = await res.json();
      setTranslatedDesc(data.translatedText);
      incrementTranslationCount();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Translation Error", "Could not translate. Check your connection.");
    } finally {
      setTranslating(false);
    }
  };

  const startReading = (chapter: Chapter) => {
    if (!manga) return;
    const chapterIndex = chapters.findIndex((c) => c.id === chapter.id);
    // Pass a slim chapters list (id, number, title only) for in-reader navigation.
    // Limit to 300 chapters to keep the param size reasonable.
    const slim = chapters.slice(0, 300).map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
    }));
    router.push({
      pathname: "/reader",
      params: {
        mangaId: manga.id,
        chapterId: chapter.id,
        chapterNum: chapter.number,
        mangaTitle: manga.title,
        sourceId,
        chapterIndex: String(chapterIndex),
        chaptersJson: JSON.stringify(slim),
      },
    });
  };

  const displayedChapters = showAllChapters ? chapters : chapters.slice(0, 20);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!manga) {
    const src = getSource(sourceId);
    return (
      <>
        <SourceErrorView
          errorType={sourceErr?.type}
          message={sourceErr?.message}
          sourceName={src.name}
          onVerify={sourceErr?.type === "cloudflare" || sourceErr?.type === "auth"
            ? () => setVerifyVisible(true) : undefined}
          onRetry={() => setRetryKey((k) => k + 1)}
          onBack={() => router.back()}
        />
        <SourceVerificationModal
          visible={verifyVisible}
          sourceId={sourceId}
          sourceName={src.name}
          sourceUrl={src.baseUrl}
          onVerified={() => {
            setVerifyVisible(false);
            setRetryKey((k) => k + 1);
          }}
          onDismiss={() => setVerifyVisible(false)}
        />
      </>
    );
  }

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Back Button */}
      <Pressable
        onPress={() => router.back()}
        style={[
          styles.backButton,
          { top: topPadding + 8, backgroundColor: "rgba(0,0,0,0.6)" },
        ]}
      >
        <Ionicons name="arrow-back" size={22} color="#fff" />
      </Pressable>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: 40 + (Platform.OS === "web" ? 34 : insets.bottom),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover */}
        <View style={styles.coverContainer}>
          <Image
            source={{ uri: manga.coverUrl }}
            style={styles.coverBg}
            contentFit="cover"
            blurRadius={20}
          />
          <LinearGradient
            colors={["rgba(0,0,0,0.3)", "rgba(0,0,0,0.6)", colors.background]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.coverContent, { paddingTop: topPadding + 60 }]}>
            <Image
              source={{ uri: manga.coverUrl }}
              style={[styles.cover, { borderRadius: colors.radius }]}
              contentFit="cover"
              transition={300}
            />
            <View style={styles.coverMeta}>
              <Text style={styles.coverTitle} numberOfLines={3}>
                {manga.title}
              </Text>
              {manga.author && (
                <Text style={styles.coverAuthor}>{manga.author}</Text>
              )}
              <View style={styles.badges}>
                {manga.status && (
                  <View style={[styles.badge, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
                    <Text style={styles.badgeText}>
                      {manga.status.charAt(0).toUpperCase() + manga.status.slice(1)}
                    </Text>
                  </View>
                )}
                {manga.year && (
                  <View style={[styles.badge, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
                    <Text style={styles.badgeText}>{manga.year}</Text>
                  </View>
                )}
                {manga.rating && (
                  <View style={[styles.badge, { backgroundColor: `${colors.primary}40` }]}>
                    <Text style={[styles.badgeText, { color: "#FFD700" }]}>
                      {"\u2605"} {manga.rating.toFixed(1)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          {chapters.length > 0 && (
            <Pressable
              onPress={() => {
                const ch = progress
                  ? chapters.find((c) => c.id === progress.chapterId) || chapters[chapters.length - 1]
                  : chapters[chapters.length - 1];
                if (ch) startReading(ch);
              }}
              style={[styles.readBtn, { backgroundColor: colors.primary, borderRadius: colors.radius }]}
            >
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={styles.readBtnText}>
                {progress ? "Continue Reading" : "Start Reading"}
              </Text>
            </Pressable>
          )}
          <View style={styles.iconActions}>
            <Pressable
              onPress={() =>
                inLib
                  ? handleRemove()
                  : handleAddToLibrary("favorites")
              }
              style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons
                name={inLib ? "heart" : "heart-outline"}
                size={22}
                color={inLib ? colors.primary : colors.foreground}
              />
            </Pressable>
            {!inLib && (
              <>
                <Pressable
                  onPress={() => handleAddToLibrary("reading")}
                  style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Ionicons name="book-outline" size={22} color={colors.foreground} />
                </Pressable>
                <Pressable
                  onPress={() => handleAddToLibrary("planned")}
                  style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Ionicons name="time-outline" size={22} color={colors.foreground} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* Genres */}
        {manga.genres && manga.genres.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.genreRow}
          >
            {manga.genres.map((g) => (
              <View
                key={g}
                style={[
                  styles.genrePill,
                  { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}30`, borderRadius: 14 },
                ]}
              >
                <Text style={[styles.genreText, { color: colors.primary }]}>{g}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Description */}
        {manga.description && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Synopsis</Text>
              <Pressable
                onPress={translatedDesc ? () => setTranslatedDesc(null) : handleTranslate}
                disabled={translating}
                style={[
                  styles.translateBtn,
                  { backgroundColor: `${colors.primary}20`, borderColor: `${colors.primary}40`, borderRadius: 14 },
                ]}
              >
                {translating ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="sparkles" size={14} color={colors.primary} />
                )}
                <Text style={[styles.translateText, { color: colors.primary }]}>
                  {translatedDesc ? "Show Original" : "AI Translate"}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              {translatedDesc || manga.description}
            </Text>
            {translatedDesc && (
              <View style={[styles.translatedBadge, { backgroundColor: `${colors.primary}15` }]}>
                <Ionicons name="sparkles" size={12} color={colors.primary} />
                <Text style={[styles.translatedBadgeText, { color: colors.primary }]}>
                  AI Translated to {readerSettings.targetLanguage.toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Chapters */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Chapters ({chapters.length})
            </Text>
          </View>
          <View style={[styles.chapterList, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            {displayedChapters.map((ch) => (
              <ChapterItem
                key={ch.id}
                chapter={ch}
                onPress={() => startReading(ch)}
                isCurrent={progress?.chapterId === ch.id}
              />
            ))}
            {chapters.length > 20 && !showAllChapters && (
              <Pressable
                onPress={() => setShowAllChapters(true)}
                style={[styles.showMore, { borderTopColor: colors.border }]}
              >
                <Text style={[styles.showMoreText, { color: colors.primary }]}>
                  Show {chapters.length - 20} more chapters
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: { fontSize: 16 },
  backBtn: { padding: 16 },
  backButton: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  coverContainer: {
    height: 380,
    overflow: "hidden",
  },
  coverBg: {
    ...StyleSheet.absoluteFillObject,
  },
  coverContent: {
    flex: 1,
    flexDirection: "row",
    paddingHorizontal: 16,
    alignItems: "flex-end",
    paddingBottom: 24,
    gap: 16,
  },
  cover: {
    width: 120,
    height: 175,
    flexShrink: 0,
  },
  coverMeta: {
    flex: 1,
    gap: 8,
  },
  coverTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700" as const,
    lineHeight: 26,
  },
  coverAuthor: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "500" as const,
  },
  actions: {
    padding: 16,
    gap: 12,
  },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    gap: 8,
  },
  readBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600" as const,
  },
  iconActions: {
    flexDirection: "row",
    gap: 10,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  genreRow: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
    paddingBottom: 8,
  },
  genrePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  section: {
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600" as const,
  },
  translateBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    gap: 5,
  },
  translateText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
  },
  translatedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  translatedBadgeText: {
    fontSize: 11,
    fontWeight: "500" as const,
  },
  chapterList: {
    borderWidth: 1,
    overflow: "hidden",
  },
  showMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    gap: 6,
  },
  showMoreText: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
});
