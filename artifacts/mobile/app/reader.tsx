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
  Alert,
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
import { useDownloads } from "@/context/DownloadContext";
import { useLibrary } from "@/context/LibraryContext";
import * as DM from "@/services/downloadManager";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";
import { AppErrorModal, classifyError } from "@/components/AppErrorModal";
import { getSource, SourceError } from "@/services/sources";
import { SourceErrorView } from "@/components/SourceErrorView";
import SourceStatusBanner from "@/components/SourceStatusBanner";
import MangaPage, { TextRegion } from "@/components/MangaPage";
import {
  translationQueue,
  QueueProgress,
  OnPageTranslated,
} from "@/services/translationQueue";
import { useTokens } from "@/context/TokenContext";
import { useInpaintServer } from "@/hooks/useInpaintServer";
import { callInpaintServer } from "@/services/inpaintClient";
import { useReaderPreloader } from "@/hooks/useReaderPreloader";
import { getApiBase } from "@/services/api";

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
    // Chapter navigation (passed from manga.tsx)
    chapterIndex: string;
    chaptersJson: string;
  }>();

  // ── Minimal chapter shape for in-reader navigation ────────────────────────
  type NavChapter = { id: string; number: string; title?: string };

  // Parse + sort chapters ascending by chapter number so next/prev are intuitive.
  const chaptersForNav = React.useMemo<NavChapter[]>(() => {
    if (!params.chaptersJson) return [];
    try {
      const raw: NavChapter[] = JSON.parse(params.chaptersJson);
      return [...raw].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
    } catch {
      return [];
    }
  }, [params.chaptersJson]);

  // Active chapter state — overrides params when user navigates next/prev.
  const [activeChapterId, setActiveChapterId] = useState(params.chapterId);
  const [activeChapterNum, setActiveChapterNum] = useState(params.chapterNum);

  const currentNavIdx = chaptersForNav.findIndex((c) => c.id === activeChapterId);
  const prevChapter = currentNavIdx > 0 ? chaptersForNav[currentNavIdx - 1] : null;
  const nextChapter = currentNavIdx >= 0 && currentNavIdx < chaptersForNav.length - 1
    ? chaptersForNav[currentNavIdx + 1]
    : null;

  const { readerSettings, updateReaderSettings, incrementTranslationCount } =
    useSettings();
  const { tokens, activeTokenId, markRateLimited } = useTokens();
  const { serverUrl: inpaintServerUrl } = useInpaintServer();

  // Always compute the live active key directly from state — no closure risk
  const getLiveKey = (): string | null => {
    if (!activeTokenId) return null;
    const token = tokens.find((t) => t.id === activeTokenId);
    if (!token || token.isRateLimited) return null;
    return token.key;
  };
  const { saveProgress } = useLibrary();
  const { dlState, dlProgress, downloadChapter: startDownload, deleteChapter } = useDownloads();

  // ── Page state ────────────────────────────────────────────────────────────
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // ── Reader state ──────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);

  // ── Preloader — warms expo-image cache ahead/behind viewport ─────────────
  useReaderPreloader({
    pages,
    sourceId: params.sourceId || "mangadex",
    currentPage,
    enabled: Platform.OS !== "web" && pages.length > 0,
  });

  // ── Translation state ─────────────────────────────────────────────────────
  const [pageTranslations, setPageTranslations] = useState<PageTranslations>({});
  const [singlePageTranslating, setSinglePageTranslating] = useState(false);

  // ── Queue state ───────────────────────────────────────────────────────────
  const [queueProgress, setQueueProgress] = useState<QueueProgress | null>(null);
  const [statusBanner, setStatusBanner] = useState<string>("");
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Error modal state ─────────────────────────────────────────────────────
  const [errorModal, setErrorModal] = useState<{ visible: boolean; title: string; message: string }>({
    visible: false,
    title: "",
    message: "",
  });

  const showErrorModal = useCallback((title: string, message: string) => {
    setErrorModal({ visible: true, title, message });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  const dismissErrorModal = useCallback(() => {
    setErrorModal((prev) => ({ ...prev, visible: false }));
  }, []);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const flatListRef = useRef<FlatList>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(0);
  const saveProgressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;
  const isVertical = readerSettings.readingMode === "vertical";
  const isRTL = readerSettings.targetLanguage === "ar";
  // getApiBase() returns "" on web (proxy handles routing) and the full
  // EXPO_PUBLIC_API_URL on native so Expo Go / APK can reach the API server.
  const apiBase = getApiBase();

  // ─── Load pages ────────────────────────────────────────────────────────────
  // Depends on activeChapterId (state), not params.chapterId, so next/prev
  // chapter navigation triggers a fresh load without remounting the screen.
  // An AbortController is created per load; cleanup aborts any in-flight request
  // when the chapter changes or the component unmounts.
  useEffect(() => {
    if (!activeChapterId) return;
    const sid = params.sourceId || "mangadex";
    const source = getSource(sid);
    const controller = new AbortController();

    setLoading(true);
    setLoadError(null);
    setPages([]);
    setCurrentPage(0);
    currentPageRef.current = 0;
    setPageTranslations({});
    setQueueProgress(null);
    translationQueue.cancel();

    (async () => {
      try {
        // ── Offline first: use locally saved pages if available ──────────────
        const local = await DM.getDownloadedPages(sid, params.mangaId, activeChapterId);
        if (local && local.length > 0) {
          if (controller.signal.aborted) return;
          setPages(local);
          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
          }, 50);
          return;
        }

        // ── Network fetch ────────────────────────────────────────────────────
        const p = await source.getChapterPages(activeChapterId, controller.signal);
        if (controller.signal.aborted) return;
        const valid = (p || []).filter(
          (u) => typeof u === "string" && (u.startsWith("http") || u.startsWith("file://"))
        );
        if (valid.length === 0) {
          setLoadError("No pages found for this chapter.");
        } else {
          setPages(valid);
          setTimeout(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
          }, 50);
        }
      } catch (err) {
        // Ignore aborts — they are intentional (chapter changed / unmounted)
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("[reader] getChapterPages failed:", err);
        const msg = err instanceof SourceError
          ? err.message
          : err instanceof Error ? err.message : "Failed to load chapter.";
        setLoadError(msg);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [activeChapterId, params.sourceId, params.mangaId, retryKey]);

  // ─── Save reading progress (debounced 500ms) ──────────────────────────────
  // Debounce prevents an AsyncStorage write on every scroll tick; instead we
  // only persist once the reader has settled on a page for half a second.
  useEffect(() => {
    if (params.mangaId && activeChapterId && activeChapterNum) {
      if (saveProgressTimer.current) clearTimeout(saveProgressTimer.current);
      saveProgressTimer.current = setTimeout(() => {
        saveProgress({
          mangaId: params.mangaId,
          chapterId: activeChapterId,
          chapterNum: activeChapterNum,
          pageIndex: currentPage,
          timestamp: Date.now(),
        });
      }, 500);
    }
    return () => {
      if (saveProgressTimer.current) clearTimeout(saveProgressTimer.current);
    };
  }, [
    currentPage,
    params.mangaId,
    activeChapterId,
    activeChapterNum,
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
      let regions: TextRegion[] = [];
      let summary = "";

      if (inpaintServerUrl) {
        // ── Decentralized HF inpaint server ──────────────────────────────────
        const result = await callInpaintServer(inpaintServerUrl, pageUrl, [], 90_000);
        regions = result.regions;
        summary = result.summary;
      } else {
        // ── Default local API ─────────────────────────────────────────────────
        const userKey = getLiveKey();
        const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (userKey) reqHeaders["X-Gemini-Key"] = userKey;

        const res = await new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Request timed out")), 60000);
          fetch(`${apiBase}/api/translate-image`, {
            method: "POST",
            headers: reqHeaders,
            body: JSON.stringify({
              imageUrl: pageUrl,
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
        regions = data.regions ?? [];
        summary = data.summary ?? "";
      }

      setPageTranslations((prev) => ({ ...prev, [idx]: regions }));
      setOverlayVisible(true);
      incrementTranslationCount();

      if (regions.length === 0) {
        showBanner(summary || "No text detected on this page.");
      } else {
        showBanner(`Found ${regions.length} text region${regions.length > 1 ? "s" : ""}. ${summary}`);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      showErrorModal(`Page ${idx + 1} Translation Failed`, errMsg);
    } finally {
      setSinglePageTranslating(false);
    }
  }, [
    pages,
    pageTranslations,
    apiBase,
    inpaintServerUrl,
    readerSettings.targetLanguage,
    incrementTranslationCount,
    showBanner,
    tokens,
    activeTokenId,
    markRateLimited,
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
      userApiKey: getLiveKey(),
      inpaintServerUrl: inpaintServerUrl || null,
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
      onPageError: (pageIndex, errMsg) => {
        showErrorModal(`Page ${pageIndex + 1} Failed`, errMsg);
      },
    });
  }, [
    pages,
    apiBase,
    inpaintServerUrl,
    readerSettings.targetLanguage,
    incrementTranslationCount,
    showBanner,
    showErrorModal,
    tokens,
    activeTokenId,
    markRateLimited,
  ]);

  // ─── Chapter navigation (in-place, no remount) ────────────────────────────
  const handleGoToChapter = useCallback((chapter: { id: string; number: string }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActiveChapterId(chapter.id);
    setActiveChapterNum(chapter.number);
    setShowControls(true);
    resetControlsTimer();
  }, [resetControlsTimer]);

  // ─── Download / delete chapter ────────────────────────────────────────────
  const chDlState = dlState[activeChapterId] ?? "idle";
  const chDlProgress = dlProgress[activeChapterId] ?? null;

  const handleDownload = useCallback(async () => {
    if (Platform.OS === "web") {
      showBanner("Downloads are only available in the mobile app.");
      return;
    }
    const sid = params.sourceId || "mangadex";
    if (chDlState === "downloading") {
      deleteChapter(sid, params.mangaId, activeChapterId);
      return;
    }
    if (chDlState === "done") {
      Alert.alert(
        "Remove Download",
        `Delete the offline copy of Chapter ${activeChapterNum}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteChapter(sid, params.mangaId, activeChapterId),
          },
        ]
      );
      return;
    }
    if (pages.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await startDownload(
        params.mangaId,
        activeChapterId,
        activeChapterNum,
        params.mangaTitle ?? "Unknown",
        "",
        sid,
        pages
      );
      showBanner(`Chapter ${activeChapterNum} saved for offline reading.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("cancelled")) showBanner(`Download failed: ${msg}`);
    }
  }, [
    chDlState,
    pages,
    activeChapterId,
    activeChapterNum,
    params,
    startDownload,
    deleteChapter,
    showBanner,
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
          apiBase={apiBase}
          userApiKey={getLiveKey()}
          sourceId={params.sourceId || "mangadex"}
        />
      </Pressable>
    ),
    [handleTap, pageTranslations, overlayVisible, isRTL, apiBase, tokens, activeTokenId]
  );

  const keyExtractor = useCallback(
    (uri: string, idx: number) => `${uri}-${idx}`,
    []
  );

  // ─── Derived ───────────────────────────────────────────────────────────────
  // Only true when the page has been processed AND has actual regions.
  // Pages with no text return [] which must NOT be treated as "translated"
  // for UI purposes (button state, overlay toggle behaviour).
  const hasTranslation = (pageTranslations[currentPage]?.length ?? 0) > 0;
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
    const sid = params.sourceId || "mangadex";
    const src = getSource(sid);
    return (
      <View style={[styles.root, { justifyContent: "center" }]}>
        <SourceStatusBanner sourceId={sid} sourceName={src.name} />
        <SourceErrorView
          message={loadError ?? "No pages found for this chapter."}
          sourceName={src.name}
          onRetry={() => setRetryKey((k) => k + 1)}
          onBack={() => router.back()}
        />
      </View>
    );
  }

  const sid = params.sourceId || "mangadex";
  const readerSrc = getSource(sid);

  return (
    <View style={styles.root}>
      {/* CF verification banner — slides in if bridge detects a challenge mid-read */}
      <SourceStatusBanner sourceId={sid} sourceName={readerSrc.name} />

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
        extraData={pageTranslations}
        removeClippedSubviews={Platform.OS !== "web"}
        maxToRenderPerBatch={3}
        windowSize={5}
        initialNumToRender={2}
        getItemLayout={
          !isVertical
            ? (_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })
            : undefined
        }
        ListFooterComponent={isVertical ? (
          <View>
            <View style={{ height: 48 }} />
            {/* End-of-chapter card */}
            <View style={styles.chapterEndCard}>
              <View style={styles.chapterEndDivider} />
              <Text style={styles.chapterEndLabel}>End of Chapter {activeChapterNum}</Text>
              {nextChapter ? (
                <Pressable
                  onPress={() => handleGoToChapter(nextChapter)}
                  style={styles.chapterEndBtn}
                >
                  <View style={styles.chapterEndBtnInner}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chapterEndBtnSub}>NEXT CHAPTER</Text>
                      <Text style={styles.chapterEndBtnTitle} numberOfLines={2}>
                        Ch. {nextChapter.number}{nextChapter.title ? ` — ${nextChapter.title}` : ""}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={22} color="#fff" />
                  </View>
                </Pressable>
              ) : (
                <View style={styles.endOfSeriesBox}>
                  <Text style={styles.endOfSeriesEmoji}>🎉</Text>
                  <Text style={styles.endOfSeriesTitle}>All caught up!</Text>
                  <Text style={styles.endOfSeriesSub}>
                    You've reached the latest chapter.{"\n"}Check back soon for updates.
                  </Text>
                  <Pressable onPress={() => router.back()} style={styles.endOfSeriesBtn}>
                    <Text style={styles.endOfSeriesBtnTxt}>← Back to Manga</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        ) : null}
        style={styles.list}
      />

      {/* ── Top controls ──────────────────────────────────────────────────── */}
      {showControls && (
        <View style={[styles.topOverlay, { paddingTop: topPadding + 8, pointerEvents: "box-none" }]}>
          <LinearGradient
            colors={["rgba(0,0,0,0.90)", "rgba(0,0,0,0.45)", "transparent"]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.iconTouch}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>

            <View style={styles.topCenter}>
              <Text style={styles.topTitle} numberOfLines={1}>
                {params.mangaTitle}
              </Text>
              <Text style={styles.topSub}>Ch. {activeChapterNum}</Text>
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

            {/* Download chapter button */}
            <Pressable
              onPress={handleDownload}
              style={[
                styles.chapterTranslateBtn,
                {
                  backgroundColor:
                    chDlState === "done"
                      ? "rgba(34,197,94,0.22)"
                      : chDlState === "error"
                      ? "rgba(239,68,68,0.22)"
                      : "rgba(255,255,255,0.15)",
                  paddingHorizontal: 7,
                },
              ]}
            >
              {chDlState === "downloading" ? (
                <>
                  <ActivityIndicator color="#fff" size="small" style={{ width: 14, height: 14 }} />
                  <Text style={styles.chapterTranslateTxt}>
                    {chDlProgress ? `${chDlProgress.done}/${chDlProgress.total}` : "…"}
                  </Text>
                </>
              ) : chDlState === "done" ? (
                <Ionicons name="checkmark-circle" size={17} color="rgb(34,197,94)" />
              ) : chDlState === "error" ? (
                <Ionicons name="alert-circle-outline" size={17} color="rgb(239,68,68)" />
              ) : (
                <Ionicons name="cloud-download-outline" size={17} color="#fff" />
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
        </View>
      )}

      {/* ── Status banner ─────────────────────────────────────────────────── */}
      {statusBanner !== "" && (
        <View
          style={[styles.banner, { top: topPadding + 72, pointerEvents: "none" }]}
        >
          <Text style={styles.bannerText} numberOfLines={3}>
            {statusBanner}
          </Text>
        </View>
      )}

      {/* ── Bottom controls ────────────────────────────────────────────────── */}
      {showControls && (
        <View style={[styles.bottomOverlay, { paddingBottom: bottomPadding + 8, pointerEvents: "box-none" }]}>
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.72)", "rgba(0,0,0,0.97)"]}
            style={StyleSheet.absoluteFillObject}
          />
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
        </View>
      )}

      {/* ── Error Modal ────────────────────────────────────────────────────── */}
      <AppErrorModal
        visible={errorModal.visible}
        title={errorModal.title}
        technicalMessage={errorModal.message}
        onDismiss={dismissErrorModal}
        category={classifyError(errorModal.message)}
      />

      {/* ── Horizontal mode: Next Chapter floating banner on last page ──────── */}
      {!isVertical && nextChapter && currentPage === pages.length - 1 && pages.length > 0 && (
        <Pressable
          onPress={() => handleGoToChapter(nextChapter)}
          style={styles.nextChapterFloating}
        >
          <View style={styles.nextChapterFloatingInner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nextChapterFloatingSub}>NEXT CHAPTER</Text>
              <Text style={styles.nextChapterFloatingTitle} numberOfLines={1}>
                Ch. {nextChapter.number}{nextChapter.title ? ` — ${nextChapter.title}` : ""}
              </Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={28} color="#fff" />
          </View>
        </Pressable>
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
  // ── Chapter end card styles ────────────────────────────────────────────────
  chapterEndCard: {
    paddingHorizontal: 20,
    paddingBottom: 60,
    gap: 16,
    alignItems: "center",
  },
  chapterEndDivider: {
    height: 1,
    width: "60%",
    backgroundColor: "rgba(255,255,255,0.12)",
    marginBottom: 4,
  },
  chapterEndLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
  },
  chapterEndBtn: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  chapterEndBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  chapterEndBtnSub: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  chapterEndBtnTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700" as const,
    lineHeight: 20,
  },
  endOfSeriesBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  endOfSeriesEmoji: { fontSize: 40 },
  endOfSeriesTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700" as const,
  },
  endOfSeriesSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  endOfSeriesBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
  },
  endOfSeriesBtnTxt: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600" as const,
  },
  // ── Horizontal next chapter floating banner ────────────────────────────────
  nextChapterFloating: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingBottom: 24,
  },
  nextChapterFloatingInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 12,
  },
  nextChapterFloatingSub: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  nextChapterFloatingTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700" as const,
  },
});
