import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary } from "@/context/LibraryContext";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";
import { getSource } from "@/services/sources";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

type TranslationResult = {
  found: boolean;
  texts: Array<{ original: string; translated: string; type: string; speaker: string | null }>;
  summary: string;
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

  const { readerSettings, updateReaderSettings, incrementTranslationCount } = useSettings();
  const { saveProgress } = useLibrary();

  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  const [translating, setTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);
  const [showTranslationPanel, setShowTranslationPanel] = useState(false);

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (!params.chapterId) return;
    const source = getSource(params.sourceId || "mangadex");
    setLoading(true);
    setError(null);
    setPages([]);
    setCurrentPage(0);
    setTranslationResult(null);
    source
      .getChapterPages(params.chapterId)
      .then((p) => {
        if (!p || p.length === 0) {
          setError("No pages found for this chapter");
        } else {
          setPages(p.filter((u) => typeof u === "string" && u.startsWith("http")));
        }
      })
      .catch((err) => {
        console.error("Failed to load chapter pages:", err);
        setError("Failed to load chapter. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [params.chapterId, params.sourceId]);

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

  const resetControlsTimer = useCallback(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3500);
  }, []);

  const handleTap = useCallback(() => {
    if (showTranslationPanel) {
      setShowTranslationPanel(false);
      return;
    }
    setShowControls((prev) => {
      if (!prev) resetControlsTimer();
      return !prev;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [showTranslationPanel, resetControlsTimer]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [resetControlsTimer]);

  const handleTranslateCurrentPage = useCallback(async () => {
    const pageUrl = pages[currentPage];
    if (!pageUrl) return;

    setTranslating(true);
    setTranslationResult(null);
    setShowTranslationPanel(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    setShowControls(false);

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
      if (!res.ok) throw new Error(`Translation failed: ${res.status}`);
      const data: TranslationResult = await res.json();
      setTranslationResult(data);
      incrementTranslationCount();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("Image translation error:", err);
      setTranslationResult({
        found: false,
        texts: [],
        summary: "Translation failed. Please check your connection and try again.",
      });
    } finally {
      setTranslating(false);
    }
  }, [pages, currentPage, readerSettings.targetLanguage, incrementTranslationCount]);

  const toggleReadingMode = useCallback(() => {
    const newMode = readerSettings.readingMode === "vertical" ? "horizontal" : "vertical";
    updateReaderSettings({ readingMode: newMode });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [readerSettings.readingMode, updateReaderSettings]);

  if (loading) {
    return (
      <View style={[styles.loader, { backgroundColor: "#000" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loaderText, { color: colors.mutedForeground }]}>
          Loading chapter...
        </Text>
      </View>
    );
  }

  if (error || !pages.length) {
    return (
      <View style={[styles.loader, { backgroundColor: "#000" }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.loaderText, { color: colors.mutedForeground }]}>
          {error || "No pages available"}
        </Text>
        <Pressable onPress={() => router.back()} style={styles.backPressable}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const isVertical = readerSettings.readingMode === "vertical";

  return (
    <View style={styles.container}>
      <Pressable style={{ flex: 1 }} onPress={handleTap}>
        {isVertical ? (
          <FlatList
            ref={flatListRef}
            data={pages}
            keyExtractor={(uri, idx) => `${uri}-${idx}`}
            renderItem={({ item: uri }) => (
              <View style={styles.webtoonPage}>
                <Image
                  source={{ uri }}
                  style={styles.webtoonImage}
                  contentFit="contain"
                  transition={200}
                  onError={() => console.warn("Failed to load page:", uri)}
                />
              </View>
            )}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              const estimatedPage = Math.floor(y / SCREEN_H);
              if (estimatedPage !== currentPage) setCurrentPage(Math.max(0, estimatedPage));
            }}
            removeClippedSubviews
            maxToRenderPerBatch={3}
            windowSize={5}
            initialNumToRender={2}
            getItemLayout={(_, index) => ({
              length: Math.round(SCREEN_W / 0.7),
              offset: Math.round(SCREEN_W / 0.7) * index,
              index,
            })}
            ListFooterComponent={<View style={{ height: 60 }} />}
          />
        ) : (
          <FlatList
            ref={flatListRef}
            data={pages}
            horizontal
            pagingEnabled
            keyExtractor={(uri, idx) => `${uri}-${idx}`}
            renderItem={({ item: uri }) => (
              <View style={styles.horizontalPage}>
                <Image
                  source={{ uri }}
                  style={styles.horizontalImage}
                  contentFit="contain"
                  transition={200}
                  onError={() => console.warn("Failed to load page:", uri)}
                />
              </View>
            )}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              if (page !== currentPage) setCurrentPage(Math.max(0, page));
            }}
            removeClippedSubviews
            maxToRenderPerBatch={3}
            windowSize={5}
            getItemLayout={(_, index) => ({
              length: SCREEN_W,
              offset: SCREEN_W * index,
              index,
            })}
          />
        )}
      </Pressable>

      {/* Top Controls */}
      {showControls && (
        <LinearGradient
          colors={["rgba(0,0,0,0.92)", "rgba(0,0,0,0.5)", "transparent"]}
          style={[styles.topOverlay, { paddingTop: topPadding + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={styles.controlBtn}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <View style={styles.topTitle}>
              <Text style={styles.topTitleText} numberOfLines={1}>
                {params.mangaTitle}
              </Text>
              <Text style={styles.topSubTitle}>Ch. {params.chapterNum}</Text>
            </View>
            <View style={[styles.pageNumBadge, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Text style={styles.pageNum}>
                {currentPage + 1} / {pages.length}
              </Text>
            </View>
          </View>
        </LinearGradient>
      )}

      {/* Bottom Controls */}
      {showControls && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.75)", "rgba(0,0,0,0.97)"]}
          style={[styles.bottomOverlay, { paddingBottom: bottomPadding + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.bottomBar}>
            <Pressable
              onPress={toggleReadingMode}
              style={[styles.iconBtn, { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12 }]}
            >
              <Ionicons
                name={isVertical ? "phone-portrait-outline" : "phone-landscape-outline"}
                size={20}
                color="#fff"
              />
              <Text style={styles.iconBtnLabel}>{isVertical ? "Webtoon" : "Manga"}</Text>
            </Pressable>

            <Pressable
              onPress={handleTranslateCurrentPage}
              disabled={translating}
              style={[styles.aiBtn, { backgroundColor: colors.primary, borderRadius: 22 }]}
            >
              {translating ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="sparkles" size={18} color="#fff" />
              )}
              <Text style={styles.aiBtnText}>
                {translating ? "Analyzing..." : "AI Translate"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.back()}
              style={[styles.iconBtn, { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12 }]}
            >
              <Ionicons name="list-outline" size={20} color="#fff" />
              <Text style={styles.iconBtnLabel}>Chapters</Text>
            </Pressable>
          </View>
        </LinearGradient>
      )}

      {/* AI Translation Panel */}
      {showTranslationPanel && (
        <View
          style={[
            styles.translationPanel,
            { backgroundColor: colors.card, paddingBottom: bottomPadding + 16 },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.panelHandle}>
            <View style={[styles.handleBar, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.panelHeader}>
            <Ionicons name="sparkles" size={18} color={colors.primary} />
            <Text style={[styles.panelTitle, { color: colors.foreground }]}>
              AI Translation — Page {currentPage + 1}
            </Text>
            <Pressable
              onPress={() => setShowTranslationPanel(false)}
              style={styles.panelClose}
            >
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {translating ? (
            <View style={styles.panelLoading}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[styles.panelLoadingText, { color: colors.mutedForeground }]}>
                Analyzing image and extracting text...
              </Text>
            </View>
          ) : translationResult ? (
            <ScrollView
              style={styles.panelScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 10 }}
            >
              {translationResult.summary ? (
                <View
                  style={[
                    styles.summaryBox,
                    { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}25` },
                  ]}
                >
                  <Text style={[styles.summaryLabel, { color: colors.primary }]}>
                    PAGE SUMMARY
                  </Text>
                  <Text style={[styles.summaryText, { color: colors.foreground }]}>
                    {translationResult.summary}
                  </Text>
                </View>
              ) : null}

              {!translationResult.found || translationResult.texts.length === 0 ? (
                <View style={styles.noTextBox}>
                  <Ionicons name="text-outline" size={32} color={colors.mutedForeground} />
                  <Text style={[styles.noTextLabel, { color: colors.mutedForeground }]}>
                    No readable text detected on this page
                  </Text>
                </View>
              ) : (
                translationResult.texts.map((item, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.textCard,
                      { backgroundColor: colors.background, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.textCardHeader}>
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: typeColor(item.type, colors.primary) + "22" },
                        ]}
                      >
                        <Text style={[styles.typeLabel, { color: typeColor(item.type, colors.primary) }]}>
                          {item.type?.toUpperCase() ?? "TEXT"}
                        </Text>
                      </View>
                      {item.speaker && (
                        <Text style={[styles.speakerText, { color: colors.mutedForeground }]}>
                          {item.speaker}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.originalText, { color: colors.mutedForeground }]}>
                      {item.original}
                    </Text>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <Text
                      style={[
                        styles.translatedText,
                        { color: colors.foreground },
                        readerSettings.targetLanguage === "ar" && styles.rtlText,
                      ]}
                    >
                      {item.translated}
                    </Text>
                  </View>
                ))
              )}

              <Pressable
                onPress={handleTranslateCurrentPage}
                style={[styles.retranslateBtn, { borderColor: colors.primary, borderRadius: 12 }]}
              >
                <Ionicons name="refresh-outline" size={16} color={colors.primary} />
                <Text style={[styles.retranslateTxt, { color: colors.primary }]}>
                  Re-translate
                </Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </View>
      )}
    </View>
  );
}

function typeColor(type: string, primary: string): string {
  switch (type) {
    case "speech": return "#4CAF50";
    case "thought": return "#2196F3";
    case "sfx": return "#FF9800";
    case "sign": return "#9C27B0";
    case "narration": return "#00BCD4";
    default: return primary;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  loaderText: {
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  backPressable: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 4,
  },
  webtoonPage: {
    width: SCREEN_W,
    alignItems: "center",
  },
  webtoonImage: {
    width: SCREEN_W,
    aspectRatio: 0.7,
  },
  horizontalPage: {
    width: SCREEN_W,
    height: SCREEN_H,
    alignItems: "center",
    justifyContent: "center",
  },
  horizontalImage: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 12,
  },
  controlBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    flex: 1,
  },
  topTitleText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600" as const,
  },
  topSubTitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 1,
  },
  pageNumBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  pageNum: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "500" as const,
  },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 50,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    gap: 12,
  },
  iconBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
    minWidth: 64,
  },
  iconBtnLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 10,
    fontWeight: "500" as const,
  },
  aiBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 8,
    maxWidth: 200,
  },
  aiBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600" as const,
  },
  translationPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SCREEN_H * 0.72,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 20,
  },
  panelHandle: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 10,
  },
  panelTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600" as const,
  },
  panelClose: {
    padding: 4,
  },
  panelLoading: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 16,
  },
  panelLoadingText: {
    fontSize: 14,
    textAlign: "center",
  },
  panelScroll: {
    paddingHorizontal: 16,
    maxHeight: SCREEN_H * 0.55,
  },
  summaryBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 20,
  },
  noTextBox: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
  },
  noTextLabel: {
    fontSize: 14,
    textAlign: "center",
  },
  textCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  textCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeLabel: {
    fontSize: 9,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
  },
  speakerText: {
    fontSize: 12,
    fontStyle: "italic" as const,
  },
  originalText: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic" as const,
  },
  divider: {
    height: 1,
  },
  translatedText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500" as const,
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  retranslateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderWidth: 1,
    gap: 8,
    marginBottom: 8,
  },
  retranslateTxt: {
    fontSize: 14,
    fontWeight: "500" as const,
  },
});
