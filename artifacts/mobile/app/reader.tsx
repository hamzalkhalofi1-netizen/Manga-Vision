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
import {
  translationQueue,
  QueueProgress,
  OnPageTranslated,
} from "@/services/translationQueue";
import { fetchImageAsBase64 } from "@/services/imageToBase64";
import { useTokens } from "@/context/TokenContext";

const { width: SCREEN_W } = Dimensions.get("window");

type PageTranslations = Record<number, TextRegion[]>;

// ─── Viewability config (defined outside component to avoid recreation) ──────
const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 60,
  minimumViewTime: 150,
};

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

  const { readerSettings, updateReaderSettings, incrementTranslationCount } =
    useSettings();
  const { getActiveKey, markRateLimited, activeTokenId } = useTokens();
  const { saveProgress } = useLibrary();

  // ── Page state ────────────────────────────────────────────────────────────
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Reader state ──────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);

  // ── Translation state ─────────────────────────────────────────────────────
  const [pageTranslations, setPageTranslations] = useState<PageTranslations>({});
  const [singlePageTranslating, setSinglePageTranslating] = useState(false);

  // ── Queue state ───────────────────────────────────────────────────────────
  const [queueProgress, setQueueProgress] = useState<QueueProgress | null>(null);
  const [statusBanner, setStatusBanner] = useState<string>("");
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const flatListRef = useRef<FlatList>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(0);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;
  const isVertical = readerSettings.readingMode === "vertical";
  const isRTL = readerSettings.targetLanguage === "ar";
  const apiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

  // ─── Load pages ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!params.chapterId) return;
    const source = getSource(params.sourceId || "mangadex");

    setLoading(true);
    setLoadError(null);
    setPages([]);
    setCurrentPage(0);
    setPageTranslations({});
    setQueueProgress(null);
    translationQueue.cancel();

    source
      .getChapterPages(params.chapterId)
      .then((p) => {
        const valid = (p || []).filter(
          (u) => typeof u === "string" && u.startsWith("http")
        );
        if (valid.length === 0) {
          setLoadError("No pages found for this chapter.");
        } else {
          setPages(valid);
        }
      })
      .catch(() => setLoadError("Failed to load chapter. Please try again."))
      .finally(() => setLoading(false));
  }, [params.chapterId, params.sourceId]);

  // ─── Save reading progress ─────────────────────────────────────────────────
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
  }, [
    currentPage,
    params.mangaId,
    params.chapterId,
    params.chapterNum,
    saveProgress,
  ]);

  // ─── Auto-hide controls ────────────────────────────────────────────────────
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

  // ─── Viewability tracking — the ACCURATE active page tracker ──────────────
  // Uses itemVisiblePercentThreshold: 60 so the active page is always the
  // one dominating the viewport (≥60% visible), never a guess from offsets.
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;

      // Pick the item with the highest visibility fraction
      let bestIdx = viewableItems[0].index ?? 0;
      let bestFrac = (viewableItems[0] as ViewToken & { percentVisible?: number }).percentVisible ?? 0;
      for (const item of viewableItems) {
        const frac = (item as ViewToken & { percentVisible?: number }).percentVisible ?? 0;
        if (frac > bestFrac && item.index != null) {
          bestFrac = frac;
          bestIdx = item.index;
        }
      }

      if (bestIdx !== currentPageRef.current) {
        currentPageRef.current = bestIdx;
        setCurrentPage(bestIdx);
      }
    }
  );

  // ─── Show status banner briefly ────────────────────────────────────────────
  const showBanner = useCallback((msg: string, ms = 4000) => {
    setStatusBanner(msg);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setStatusBanner(""), ms);
  }, []);

  // ─── Translate SINGLE current page ────────────────────────────────────────
  const handleTranslatePage = useCallback(async () => {
    const pageUrl = pages[currentPageRef.current];
    if (!pageUrl) return;

    const idx = currentPageRef.current;

    // If already translated, toggle overlay on/off
    if (pageTranslations[idx] !== undefined) {
      setOverlayVisible((v) => !v);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    setSinglePageTranslating(true);
    setShowControls(false);

    try {
      const payload = await fetchImageAsBase64(pageUrl);
      const userKey = getActiveKey();
      const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (userKey) reqHeaders["X-Gemini-Key"] = userKey;

      const res = await new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Request timed out")), 60000);
        fetch(`${apiBase}/api/translate-image`, {
          method: "POST",
          headers: reqHeaders,
          body: JSON.stringify({
            imageData: payload.imageData,
            mimeType: payload.mimeType,
            targetLanguage: readerSettings.targetLanguage,
          }),
        }).then(
          (r) => { clearTimeout(timer); resolve(r); },
          (e) => { clearTimeout(timer); reject(e); }
        );
      });

      if (res.status === 429 && activeTokenId) {
        markRateLimited(activeTokenId, 70_000);
        showBanner("API key rate limited. Add another key in Settings.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const regions: TextRegion[] = data.regions ?? [];

      setPageTranslations((prev) => ({ ...prev, [idx]: regions }));
      setOverlayVisible(true);
      incrementTranslationCount();

      if (regions.length === 0) {
        showBanner(data.summary ?? "No text detected on this page.");
      } else {
        showBanner(`Found ${regions.length} text region${regions.length > 1 ? "s" : ""}. ${data.summary ?? ""}`);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showBanner("Translation failed. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSinglePageTranslating(false);
    }
  }, [
    pages,
    pageTranslations,
    apiBase,
    readerSettings.targetLanguage,
    incrementTranslationCount,
    showBanner,
  ]);

  // ─── Translate ENTIRE CHAPTER (sequential queue) ──────────────────────────
  const handleTranslateChapter = useCallback(async () => {
    if (translationQueue.isRunning) {
      translationQueue.cancel();
      showBanner("Translation cancelled.");
      setQueueProgress(null);
      return;
    }

    if (pages.length === 0) return;

    setOverlayVisible(true);
    setShowControls(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const onPageTranslated: OnPageTranslated = (pageIndex, regions, summary) => {
      setPageTranslations((prev) => ({ ...prev, [pageIndex]: regions }));
      if (regions.length > 0) incrementTranslationCount();
    };

    await translationQueue.start({
      pages,
      targetLanguage: readerSettings.targetLanguage,
      apiBase,
      userApiKey: getActiveKey(),
      onPageTranslated,
      onProgress: (progress) => {
        setQueueProgress(progress);
      },
      onComplete: (stats) => {
        setQueueProgress(null);
        showBanner(
          `Done! ${stats.completed} pages translated${stats.failed > 0 ? `, ${stats.failed} failed` : ""}.`,
          5000
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
      onRateLimited: () => {
        if (activeTokenId) markRateLimited(activeTokenId, 70_000);
        showBanner("API key rate limited. Add another key in Settings.", 6000);
      },
    });
  }, [
    pages,
    apiBase,
    readerSettings.targetLanguage,
    incrementTranslationCount,
    showBanner,
    getActiveKey,
    markRateLimited,
    activeTokenId,
  ]);

  // ─── Toggle reading mode ───────────────────────────────────────────────────
  const toggleMode = useCallback(() => {
    updateReaderSettings({
      readingMode: readerSettings.readingMode === "vertical" ? "horizontal" : "vertical",
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [readerSettings.readingMode, updateReaderSettings]);

  // ─── FlatList render item ──────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item: uri, index }: { item: string; index: number }) => (
      <Pressable onPress={handleTap} style={{ width: SCREEN_W }}>
        <MangaPage
          uri={uri}
          regions={pageTranslations[index]}
          showOverlay={overlayVisible}
          isRTL={isRTL}
        />
      </Pressable>
    ),
    [handleTap, pageTranslations, overlayVisible, isRTL]
  );

  const keyExtractor = useCallback(
    (uri: string, idx: number) => `${uri}-${idx}`,
    []
  );

  // ─── Derived ───────────────────────────────────────────────────────────────
  const hasTranslation = pageTranslations[currentPage] !== undefined;
  const isQueueRunning = queueProgress?.isRunning ?? false;

  // ─── Loading / Error ───────────────────────────────────────────────────────
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

  if (loadError || pages.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: "#000" }]}>
        <Ionicons name="alert-circle-outline" size={52} color={colors.mutedForeground} />
        <Text style={[styles.centeredText, { color: colors.mutedForeground }]}>
          {loadError ?? "No pages found"}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.backPressable}>
          <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" as const }}>
            ← Go Back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── Pages ─────────────────────────────────────────────────────────── */}
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
        viewabilityConfig={VIEWABILITY_CONFIG}
        removeClippedSubviews={Platform.OS !== "web"}
        maxToRenderPerBatch={3}
        windowSize={5}
        initialNumToRender={2}
        getItemLayout={
          !isVertical
            ? (_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })
            : undefined
        }
        ListFooterComponent={isVertical ? <View style={{ height: 80 }} /> : null}
        style={styles.list}
      />

      {/* ── Top controls ──────────────────────────────────────────────────── */}
      {showControls && (
        <LinearGradient
          colors={["rgba(0,0,0,0.90)", "rgba(0,0,0,0.45)", "transparent"]}
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

            {/* Translate Chapter button in top-right */}
            <Pressable
              onPress={handleTranslateChapter}
              style={[
                styles.chapterTranslateBtn,
                {
                  backgroundColor: isQueueRunning
                    ? "rgba(220,50,50,0.85)"
                    : "rgba(255,255,255,0.15)",
                },
              ]}
            >
              {isQueueRunning ? (
                <>
                  <ActivityIndicator color="#fff" size="small" style={{ width: 14, height: 14 }} />
                  <Text style={styles.chapterTranslateTxt}>
                    {queueProgress?.completed}/{pages.length}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="language-outline" size={14} color="#fff" />
                  <Text style={styles.chapterTranslateTxt}>
                    {Object.keys(pageTranslations).length > 0 ? "More" : "All"}
                  </Text>
                </>
              )}
            </Pressable>

            <View style={[styles.pageBadge, { backgroundColor: "rgba(255,255,255,0.16)" }]}>
              <Text style={styles.pageBadgeTxt}>
                {currentPage + 1}/{pages.length}
              </Text>
            </View>
          </View>

          {/* Queue progress bar */}
          {isQueueRunning && (
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${queueProgress?.percentDone ?? 0}%` as unknown as number,
                  },
                ]}
              />
            </View>
          )}
        </LinearGradient>
      )}

      {/* ── Status banner ─────────────────────────────────────────────────── */}
      {statusBanner !== "" && (
        <View
          style={[styles.banner, { top: topPadding + 72 }]}
          pointerEvents="none"
        >
          <Text style={styles.bannerText} numberOfLines={3}>
            {statusBanner}
          </Text>
        </View>
      )}

      {/* ── Bottom controls ────────────────────────────────────────────────── */}
      {showControls && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.72)", "rgba(0,0,0,0.97)"]}
          style={[styles.bottomOverlay, { paddingBottom: bottomPadding + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.bottomBar}>
            {/* Reading mode */}
            <Pressable
              onPress={toggleMode}
              style={[styles.sideBtn, { backgroundColor: "rgba(255,255,255,0.13)" }]}
            >
              <Ionicons
                name={isVertical ? "albums-outline" : "book-outline"}
                size={19}
                color="#fff"
              />
              <Text style={styles.sideBtnLabel}>
                {isVertical ? "Webtoon" : "Manga"}
              </Text>
            </Pressable>

            {/* AI Translate current page */}
            <Pressable
              onPress={handleTranslatePage}
              disabled={singlePageTranslating}
              style={[
                styles.aiBtn,
                {
                  backgroundColor:
                    hasTranslation && overlayVisible
                      ? colors.primary
                      : hasTranslation
                      ? "rgba(255,255,255,0.18)"
                      : colors.primary,
                  opacity: singlePageTranslating ? 0.75 : 1,
                },
              ]}
            >
              {singlePageTranslating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons
                  name={
                    hasTranslation && overlayVisible
                      ? "eye-outline"
                      : hasTranslation
                      ? "eye-off-outline"
                      : "sparkles"
                  }
                  size={17}
                  color="#fff"
                />
              )}
              <Text style={styles.aiBtnTxt}>
                {singlePageTranslating
                  ? "Scanning..."
                  : hasTranslation && overlayVisible
                  ? "Hide"
                  : hasTranslation
                  ? "Show"
                  : "Translate"}
              </Text>
            </Pressable>

            {/* Chapters list */}
            <Pressable
              onPress={() => router.back()}
              style={[styles.sideBtn, { backgroundColor: "rgba(255,255,255,0.13)" }]}
            >
              <Ionicons name="list-outline" size={19} color="#fff" />
              <Text style={styles.sideBtnLabel}>Chapters</Text>
            </Pressable>
          </View>

          {/* Page dots (horizontal, ≤24 pages) */}
          {!isVertical && pages.length <= 24 && (
            <View style={styles.dots}>
              {pages.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        i === currentPage
                          ? colors.primary
                          : "rgba(255,255,255,0.28)",
                      width: i === currentPage ? 18 : 6,
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
  root: { flex: 1, backgroundColor: "#000" },
  list: { flex: 1, backgroundColor: "#000" },
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
  backPressable: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 36,
    gap: 8,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 8,
  },
  iconTouch: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  topCenter: { flex: 1, gap: 1 },
  topTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700" as const,
  },
  topSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
  },
  chapterTranslateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  chapterTranslateTxt: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600" as const,
  },
  pageBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  pageBadgeTxt: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "600" as const,
  },
  progressBarTrack: {
    height: 3,
    marginHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 3,
    borderRadius: 2,
  },
  banner: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "rgba(16,16,16,0.92)",
    borderRadius: 12,
    padding: 12,
  },
  bannerText: {
    color: "#fff",
    fontSize: 13,
    lineHeight: 18,
  },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 50,
    gap: 10,
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
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 3,
    minWidth: 62,
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
  aiBtnTxt: {
    color: "#fff",
    fontSize: 15,
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
