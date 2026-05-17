import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary } from "@/context/LibraryContext";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";
import { getSource } from "@/services/sources";
import MangaPage, { TextRegion } from "@/components/MangaPage";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

type PageTranslations = Record<number, TextRegion[]>;
type TranslationStatus = "idle" | "loading" | "done" | "error";

export default function ReaderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    mangaId: string;
    chapterId: string;
    chapterNum: string;
    mangaTitle: string;
    sourceId: string;
  }>();

  const { readerSettings, updateReaderSettings, incrementTranslationCount } = useSettings();
  const { saveProgress } = useLibrary();

  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  // Per-page translation state
  const [pageTranslations, setPageTranslations] = useState<PageTranslations>({});
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus>("idle");
  const [translationSummary, setTranslationSummary] = useState<string>("");
  const [overlayVisible, setOverlayVisible] = useState(true);

  // Heights cache for FlatList getItemLayout in vertical mode
  const pageSizes = useRef<Record<number, number>>({});

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;
  const isVertical = readerSettings.readingMode === "vertical";
  const isRTL = readerSettings.targetLanguage === "ar";

  // ── Load pages ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!params.chapterId) return;
    const source = getSource(params.sourceId || "mangadex");
    setLoading(true);
    setError(null);
    setPages([]);
    setCurrentPage(0);
    setPageTranslations({});
    setTranslationStatus("idle");

    source
      .getChapterPages(params.chapterId)
      .then((p) => {
        const valid = (p || []).filter((u) => typeof u === "string" && u.startsWith("http"));
        if (valid.length === 0) {
          setError("No pages available for this chapter.");
        } else {
          setPages(valid);
        }
      })
      .catch((err) => {
        console.error("Failed to load pages:", err);
        setError("Failed to load chapter. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [params.chapterId, params.sourceId]);

  // ── Save progress ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (params.mangaId && params.chapterId && params.chapterNum) {
      saveProgress({
        mangaId: params.mangaId,
        chapterId: params.chapterId,
        chapterNum: params.chapterNum,
        pageIndex: currentPage,
        timestamp: Date.now(),
      });
    }
  }, [currentPage, params.mangaId, params.chapterId, params.chapterNum, saveProgress]);

  // ── Controls timer ────────────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3500);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [resetControlsTimer]);

  const handleTap = useCallback(() => {
    setShowControls((prev) => {
      if (!prev) resetControlsTimer();
      return !prev;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [resetControlsTimer]);

  // ── Viewability tracking ──────────────────────────────────────────────────
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
    minimumViewTime: 100,
  });

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentPage(viewableItems[0].index);
      }
    }
  );

  // ── Toggle reading mode ───────────────────────────────────────────────────
  const toggleMode = useCallback(() => {
    const next = readerSettings.readingMode === "vertical" ? "horizontal" : "vertical";
    updateReaderSettings({ readingMode: next });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [readerSettings.readingMode, updateReaderSettings]);

  // ── AI Translate current page ─────────────────────────────────────────────
  const handleTranslate = useCallback(async () => {
    const pageUrl = pages[currentPage];
    if (!pageUrl) return;

    // If already translated, toggle overlay
    if (pageTranslations[currentPage]) {
      setOverlayVisible((prev) => !prev);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    setTranslationStatus("loading");
    setShowControls(false);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const res = await fetch(`https://${domain}/api/translate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: pageUrl,
          targetLanguage: readerSettings.targetLanguage,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.regions && data.regions.length > 0) {
        setPageTranslations((prev) => ({ ...prev, [currentPage]: data.regions }));
        setOverlayVisible(true);
        setTranslationSummary(data.summary ?? "");
        incrementTranslationCount();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setTranslationSummary(data.summary ?? "No text detected on this page.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      setTranslationStatus("done");
    } catch (err) {
      console.error("Translation error:", err);
      setTranslationStatus("error");
      setTranslationSummary("Translation failed. Check connection and try again.");
    }

    // Show summary banner briefly then clear
    setTimeout(() => {
      setTranslationStatus("idle");
      setTranslationSummary("");
    }, 4000);
  }, [pages, currentPage, pageTranslations, readerSettings.targetLanguage, incrementTranslationCount]);

  // ── Height cache for getItemLayout ────────────────────────────────────────
  const handlePageHeightKnown = useCallback((index: number, height: number) => {
    pageSizes.current[index] = height;
  }, []);

  // ── Render item ───────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item: uri, index }: { item: string; index: number }) => (
      <Pressable onPress={handleTap} style={{ width: SCREEN_W }}>
        <MangaPage
          uri={uri}
          regions={pageTranslations[index]}
          showOverlay={overlayVisible}
          isRTL={isRTL}
          onHeightKnown={(h) => handlePageHeightKnown(index, h)}
        />
      </Pressable>
    ),
    [handleTap, pageTranslations, overlayVisible, isRTL, handlePageHeightKnown]
  );

  const keyExtractor = useCallback((uri: string, idx: number) => `${uri}-${idx}`, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const hasTranslation = !!pageTranslations[currentPage];
  const isTranslating = translationStatus === "loading";

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: "#000" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.centeredText, { color: colors.mutedForeground }]}>
          Loading chapter...
        </Text>
      </View>
    );
  }

  if (error || pages.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: "#000" }]}>
        <Ionicons name="alert-circle-outline" size={52} color={colors.mutedForeground} />
        <Text style={[styles.centeredText, { color: colors.mutedForeground }]}>
          {error ?? "No pages found"}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" as const }}>
            ← Go Back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Pages ── */}
      <FlatList
        ref={flatListRef}
        data={pages}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        horizontal={!isVertical}
        pagingEnabled={!isVertical}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={viewabilityConfig.current}
        removeClippedSubviews={Platform.OS !== "web"}
        maxToRenderPerBatch={3}
        windowSize={5}
        initialNumToRender={2}
        // Static getItemLayout for horizontal mode only (pages are SCREEN_W wide)
        getItemLayout={
          !isVertical
            ? (_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })
            : undefined
        }
        ListFooterComponent={isVertical ? <View style={{ height: 80 }} /> : null}
        style={styles.list}
        contentContainerStyle={isVertical ? undefined : undefined}
      />

      {/* ── Top bar ── */}
      {showControls && (
        <LinearGradient
          colors={["rgba(0,0,0,0.88)", "rgba(0,0,0,0.45)", "transparent"]}
          style={[styles.topOverlay, { paddingTop: topPadding + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.iconTouch}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>

            <View style={styles.topCenter}>
              <Text style={styles.topTitle} numberOfLines={1}>
                {params.mangaTitle}
              </Text>
              <Text style={styles.topSub}>Ch. {params.chapterNum}</Text>
            </View>

            <View style={[styles.pageBadge, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
              <Text style={styles.pageBadgeText}>
                {currentPage + 1} / {pages.length}
              </Text>
            </View>
          </View>
        </LinearGradient>
      )}

      {/* ── Translation status banner ── */}
      {(isTranslating || translationSummary) && (
        <View
          style={[
            styles.statusBanner,
            {
              top: topPadding + 70,
              backgroundColor:
                translationStatus === "error"
                  ? "rgba(200,40,40,0.92)"
                  : "rgba(20,20,20,0.92)",
            },
          ]}
          pointerEvents="none"
        >
          {isTranslating ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={[styles.statusText, { color: "#fff" }]}>
                Scanning page for text...
              </Text>
            </View>
          ) : (
            <Text style={[styles.statusText, { color: "#fff" }]} numberOfLines={3}>
              {translationSummary}
            </Text>
          )}
        </View>
      )}

      {/* ── Bottom bar ── */}
      {showControls && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.7)", "rgba(0,0,0,0.96)"]}
          style={[styles.bottomOverlay, { paddingBottom: bottomPadding + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.bottomBar}>
            {/* Mode toggle */}
            <Pressable
              onPress={toggleMode}
              style={[styles.sideBtn, { backgroundColor: "rgba(255,255,255,0.12)" }]}
            >
              <Ionicons
                name={isVertical ? "albums-outline" : "phone-portrait-outline"}
                size={19}
                color="#fff"
              />
              <Text style={styles.sideBtnLabel}>
                {isVertical ? "Webtoon" : "Manga"}
              </Text>
            </Pressable>

            {/* AI Translate */}
            <Pressable
              onPress={handleTranslate}
              disabled={isTranslating}
              style={[
                styles.aiBtn,
                {
                  backgroundColor: hasTranslation
                    ? overlayVisible
                      ? colors.primary
                      : "rgba(255,255,255,0.18)"
                    : colors.primary,
                  opacity: isTranslating ? 0.7 : 1,
                },
              ]}
            >
              {isTranslating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons
                  name={hasTranslation && overlayVisible ? "eye-outline" : "sparkles"}
                  size={17}
                  color="#fff"
                />
              )}
              <Text style={styles.aiBtnText}>
                {isTranslating
                  ? "Scanning..."
                  : hasTranslation
                  ? overlayVisible
                    ? "Hide Translation"
                    : "Show Translation"
                  : "AI Translate"}
              </Text>
            </Pressable>

            {/* Chapters */}
            <Pressable
              onPress={() => router.back()}
              style={[styles.sideBtn, { backgroundColor: "rgba(255,255,255,0.12)" }]}
            >
              <Ionicons name="list-outline" size={19} color="#fff" />
              <Text style={styles.sideBtnLabel}>Chapters</Text>
            </Pressable>
          </View>

          {/* Page dots (horizontal mode only, up to 12 pages) */}
          {!isVertical && pages.length <= 24 && (
            <View style={styles.dots}>
              {pages.slice(0, 24).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        i === currentPage
                          ? colors.primary
                          : "rgba(255,255,255,0.3)",
                      width: i === currentPage ? 16 : 6,
                    },
                  ]}
                />
              ))}
            </View>
          )}
        </LinearGradient>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  list: {
    flex: 1,
    backgroundColor: "#000",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
  },
  centeredText: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 36,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 10,
  },
  iconTouch: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  topCenter: {
    flex: 1,
    gap: 1,
  },
  topTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700" as const,
  },
  topSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
  },
  pageBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  pageBadgeText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "600" as const,
  },
  statusBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 12,
    padding: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    gap: 12,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
  },
  sideBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 3,
    minWidth: 66,
  },
  sideBtnLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 10,
    fontWeight: "500" as const,
  },
  aiBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 22,
    gap: 8,
  },
  aiBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700" as const,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingBottom: 4,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
