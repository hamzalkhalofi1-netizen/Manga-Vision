import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLibrary } from "@/context/LibraryContext";
import { useSettings } from "@/context/SettingsContext";
import { useColors } from "@/hooks/useColors";
import { getSource } from "@/services/sources";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

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

  const { readerSettings, incrementTranslationCount } = useSettings();
  const { saveProgress } = useLibrary();

  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [translateModal, setTranslateModal] = useState(false);
  const [translateInput, setTranslateInput] = useState("");
  const [translateResult, setTranslateResult] = useState("");
  const [translating, setTranslating] = useState(false);

  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (!params.chapterId) return;
    const source = getSource(params.sourceId || "mangadex");
    setLoading(true);
    source
      .getChapterPages(params.chapterId)
      .then((p) => setPages(p))
      .catch(() => setPages([]))
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

  const handleTap = useCallback(() => {
    setShowControls((prev) => {
      const next = !prev;
      if (next) {
        if (controlsTimer.current) clearTimeout(controlsTimer.current);
        controlsTimer.current = setTimeout(() => setShowControls(false), 3500);
      }
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  useEffect(() => {
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, []);

  const handleTranslate = async () => {
    if (!translateInput.trim()) return;
    setTranslating(true);
    setTranslateResult("");
    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const res = await fetch(`https://${domain}/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: translateInput,
          targetLanguage: readerSettings.targetLanguage,
          context: `Manga speech bubble text from "${params.mangaTitle}", chapter ${params.chapterNum}. Preserve character tone, emotion, and dramatic impact.`,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setTranslateResult(data.translatedText);
      incrementTranslationCount();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Translation failed", "Could not connect to AI. Check your connection.");
    } finally {
      setTranslating(false);
    }
  };

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

  if (!pages.length) {
    return (
      <View style={[styles.loader, { backgroundColor: "#000" }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.loaderText, { color: colors.mutedForeground }]}>
          No pages available
        </Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: colors.primary, marginTop: 12 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable style={{ flex: 1 }} onPress={handleTap}>
        {readerSettings.readingMode === "vertical" ? (
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const y = e.nativeEvent.contentOffset.y;
              const estimatedPage = Math.floor(y / SCREEN_H);
              if (estimatedPage !== currentPage) setCurrentPage(Math.max(0, estimatedPage));
            }}
          >
            {pages.map((uri, idx) => (
              <Image
                key={`${uri}-${idx}`}
                source={{ uri }}
                style={{ width: SCREEN_W, aspectRatio: 0.7 }}
                contentFit="contain"
                transition={200}
              />
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              if (page !== currentPage) setCurrentPage(page);
            }}
          >
            {pages.map((uri, idx) => (
              <Image
                key={`${uri}-${idx}`}
                source={{ uri }}
                style={{ width: SCREEN_W, height: SCREEN_H }}
                contentFit="contain"
                transition={200}
              />
            ))}
          </ScrollView>
        )}
      </Pressable>

      {/* Top Controls */}
      {showControls && (
        <LinearGradient
          colors={["rgba(0,0,0,0.9)", "rgba(0,0,0,0.5)", "transparent"]}
          style={[styles.topOverlay, { paddingTop: topPadding + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.topBar}>
            <Pressable
              onPress={() => router.back()}
              style={styles.controlBtn}
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <View style={styles.topTitle}>
              <Text style={styles.topTitleText} numberOfLines={1}>
                {params.mangaTitle}
              </Text>
              <Text style={styles.topSubTitle}>Ch. {params.chapterNum}</Text>
            </View>
            <View style={styles.topRight}>
              <Text style={styles.pageNum}>
                {currentPage + 1}/{pages.length}
              </Text>
            </View>
          </View>
        </LinearGradient>
      )}

      {/* Bottom Controls */}
      {showControls && (
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.7)", "rgba(0,0,0,0.95)"]}
          style={[styles.bottomOverlay, { paddingBottom: bottomPadding + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.bottomBar}>
            <Pressable
              style={[styles.modeBtn, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 8 }]}
              onPress={() => {}}
            >
              <Ionicons
                name={readerSettings.readingMode === "vertical" ? "phone-portrait-outline" : "phone-landscape-outline"}
                size={18}
                color={colors.foreground}
              />
            </Pressable>
            <Pressable
              onPress={() => setTranslateModal(true)}
              style={[
                styles.aiBtn,
                { backgroundColor: colors.primary, borderRadius: 20 },
              ]}
            >
              <Ionicons name="sparkles" size={16} color="#fff" />
              <Text style={styles.aiBtnText}>AI Translate</Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 8 }]}
              onPress={() => router.back()}
            >
              <Ionicons name="list" size={18} color={colors.foreground} />
            </Pressable>
          </View>
        </LinearGradient>
      )}

      {/* AI Translate Modal */}
      <Modal
        visible={translateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setTranslateModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTranslateModal(false)}
        />
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: colors.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: bottomPadding + 16,
            },
          ]}
        >
          <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
          <View style={styles.modalHeader}>
            <Ionicons name="sparkles" size={20} color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              AI Speech Bubble Translator
            </Text>
          </View>
          <Text style={[styles.modalDesc, { color: colors.mutedForeground }]}>
            Paste text from a speech bubble and get an AI-powered translation that preserves the character's tone and emotion.
          </Text>
          <TextInput
            value={translateInput}
            onChangeText={setTranslateInput}
            placeholder="Paste original speech bubble text here..."
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.modalInput,
              {
                backgroundColor: colors.background,
                color: colors.foreground,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
            multiline
            numberOfLines={4}
          />
          {translateResult ? (
            <View
              style={[
                styles.resultBox,
                { backgroundColor: `${colors.primary}15`, borderColor: `${colors.primary}30`, borderRadius: colors.radius },
              ]}
            >
              <Text style={[styles.resultLabel, { color: colors.primary }]}>
                Translated
              </Text>
              <Text style={[styles.resultText, { color: colors.foreground }]}>
                {translateResult}
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={handleTranslate}
            disabled={translating || !translateInput.trim()}
            style={[
              styles.translateSubmit,
              {
                backgroundColor:
                  translating || !translateInput.trim()
                    ? colors.muted
                    : colors.primary,
                borderRadius: colors.radius,
              },
            ]}
          >
            {translating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="sparkles" size={18} color="#fff" />
            )}
            <Text style={styles.translateSubmitText}>
              {translating ? "Translating..." : "Translate"}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
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
    gap: 12,
  },
  loaderText: {
    fontSize: 15,
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
  },
  topRight: {
    alignItems: "flex-end",
  },
  pageNum: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
  },
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 40,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  modeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  aiBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600" as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalSheet: {
    padding: 20,
    gap: 14,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600" as const,
  },
  modalDesc: {
    fontSize: 13,
    lineHeight: 20,
  },
  modalInput: {
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: "top",
  },
  resultBox: {
    padding: 12,
    borderWidth: 1,
    gap: 6,
  },
  resultLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.5,
  },
  resultText: {
    fontSize: 15,
    lineHeight: 22,
  },
  translateSubmit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    gap: 8,
  },
  translateSubmitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600" as const,
  },
});
