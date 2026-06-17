import { Ionicons } from "@expo/vector-icons";
import { Linking } from "react-native";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings, ThemeMode } from "@/context/SettingsContext";
import { useTokens, GeminiToken, maskKey } from "@/context/TokenContext";
import { useColors } from "@/hooks/useColors";
import { useInpaintServer } from "@/hooks/useInpaintServer";
import { clearTranslationCache, getTranslationCacheSize } from "@/services/translationQueue";
import { getCvDebugEntries, clearCvDebugEntries, subscribeCvDebug, type CvDebugEntry } from "@/services/cvDebugStore";

type Language = { code: string; label: string };

const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
];

function SectionLabel({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionLabel, { color: colors.primary }]}>{title.toUpperCase()}</Text>
  );
}

function SettingRow({
  icon,
  label,
  description,
  right,
  onPress,
  last,
}: {
  icon: string;
  label: string;
  description?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? "rgba(255,255,255,0.04)" : "transparent",
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: `${colors.primary}20` }]}>
        <Ionicons name={icon as never} size={18} color={colors.primary} />
      </View>
      <View style={styles.rowMiddle}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        {description && (
          <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{description}</Text>
        )}
      </View>
      {right !== undefined ? right : <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
    </Pressable>
  );
}

function TokenRow({ token, isActive, onActivate, onRemove, onClearLimit }: {
  token: GeminiToken;
  isActive: boolean;
  onActivate: () => void;
  onRemove: () => void;
  onClearLimit: () => void;
}) {
  const colors = useColors();
  const expired = token.isRateLimited && token.rateLimitedUntil && Date.now() > token.rateLimitedUntil;
  const isRateLimited = token.isRateLimited && !expired;

  let statusColor = colors.mutedForeground;
  let statusLabel = "Available";
  if (isActive) { statusColor = colors.primary; statusLabel = "Active"; }
  else if (isRateLimited) { statusColor = "#f87171"; statusLabel = "Rate Limited"; }

  return (
    <View style={[styles.tokenRow, { borderBottomColor: colors.border }]}>
      <Pressable onPress={onActivate} style={styles.tokenMain}>
        <View style={[
          styles.tokenDot,
          { backgroundColor: isActive ? colors.primary : isRateLimited ? "#f87171" : colors.border }
        ]} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.tokenLabel, { color: colors.foreground }]}>{token.label}</Text>
          <Text style={[styles.tokenKey, { color: colors.mutedForeground }]}>{maskKey(token.key)}</Text>
        </View>
        <Text style={[styles.tokenStatus, { color: statusColor }]}>{statusLabel}</Text>
      </Pressable>
      <View style={styles.tokenActions}>
        {isRateLimited && (
          <Pressable onPress={onClearLimit} style={styles.tokenActionBtn}>
            <Ionicons name="refresh-outline" size={16} color={colors.primary} />
          </Pressable>
        )}
        <Pressable
          onPress={() =>
            Alert.alert(
              "حذف المفتاح",
              "هل أنت متأكد من حذف مفتاح الـ API بشكل نهائي؟",
              [
                { text: "إلغاء", style: "cancel" },
                { text: "حذف", style: "destructive", onPress: onRemove },
              ],
              { cancelable: true }
            )
          }
          style={styles.tokenActionBtn}
        >
          <Ionicons name="trash-outline" size={16} color="#f87171" />
        </Pressable>
      </View>
    </View>
  );
}

function DebugField({
  label,
  value,
  colors,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <View style={styles.debugFieldRow}>
      <Text style={[styles.debugFieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[
          styles.debugFieldValue,
          { color: highlight ? "#f87171" : colors.foreground },
          mono && { fontFamily: "monospace", fontSize: 10 },
        ]}
        numberOfLines={3}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

function AddKeyPanel({ onAdd, colors }: {
  onAdd: (key: string, label: string) => Promise<void>;
  colors: ReturnType<typeof useColors>;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    await onAdd(key.trim(), label.trim());
    setKey("");
    setLabel("");
    setLoading(false);
  };

  return (
    <View style={[styles.addPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.addPanelTitle, { color: colors.foreground }]}>Add Gemini API Key</Text>
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Label (e.g. My Key)"
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
      />
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder="AIzaSy..."
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Pressable
        onPress={handleAdd}
        disabled={!key.trim() || loading}
        style={[
          styles.addBtn,
          {
            backgroundColor: key.trim() ? colors.primary : colors.muted,
            opacity: loading ? 0.7 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.addBtnText}>Save Key</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { readerSettings, updateReaderSettings, themeMode, setThemeMode } = useSettings();
  const { tokens, activeTokenId, addToken, removeToken, setActiveToken, markRateLimited, clearRateLimit } = useTokens();
  const { serverUrl, setServerUrl } = useInpaintServer();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(serverUrl);
  const [serverUrlSaving, setServerUrlSaving] = useState(false);
  const [pingStatus, setPingStatus] = useState<"idle" | "checking" | "online" | "offline">("idle");
  const [cacheSize, setCacheSize] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);
  const [debugEntries, setDebugEntries] = useState<CvDebugEntry[]>(() => getCvDebugEntries());

  useEffect(() => {
    setCacheSize(getTranslationCacheSize());
  }, []);

  useEffect(() => {
    const unsub = subscribeCvDebug(setDebugEntries);
    return unsub;
  }, []);

  const handleCheckServer = async () => {
    const target = serverUrlInput.trim().replace(/\/$/, "");
    if (!target) return;
    setPingStatus("checking");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${target}/`, { method: "GET", signal: controller.signal });
      clearTimeout(timer);
      setPingStatus(res.ok ? "online" : "offline");
    } catch {
      setPingStatus("offline");
    }
  };

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  React.useEffect(() => {
    if (serverUrl) setServerUrlInput(serverUrl);
  }, [serverUrl]);

  const handleSaveServerUrl = async () => {
    setServerUrlSaving(true);
    await setServerUrl(serverUrlInput);
    setServerUrlSaving(false);
    Alert.alert("Saved", "Inpaint server URL has been saved.");
  };

  const handleOpenHFDeploy = async () => {
    const url = "https://huggingface.co/spaces/new?template=yamihot123/mangaverse-inpaint-core";
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      console.log("Don't know how to open URI: " + url);
    }
  };

  const handleAddKey = async (key: string, label: string) => {
    const result = await addToken(key, label || undefined);
    if (!result.ok) {
      Alert.alert("Invalid Key", result.error ?? "Could not add key.");
    } else {
      setShowAddPanel(false);
    }
  };

  const handleRemoveToken = (id: string) => {
    removeToken(id);
    setShowAddPanel(false);
  };

  const handleClearCache = async () => {
    Alert.alert(
      "Clear Translation Cache",
      "This will delete all saved translations. Pages will need to be re-translated. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            setClearingCache(true);
            await clearTranslationCache();
            setCacheSize(0);
            setClearingCache(false);
            Alert.alert("Cache Cleared", "All saved translations have been removed.");
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* Appearance */}
        <View style={styles.section}>
          <SectionLabel title="Appearance" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <SettingRow
              icon="contrast-outline"
              label="Theme"
              description={themeMode === "auto" ? "Follows system setting" : themeMode === "dark" ? "Always dark" : "Always light"}
              right={
                <View style={styles.toggleRow}>
                  {(["auto", "light", "dark"] as ThemeMode[]).map((mode) => (
                    <Pressable
                      key={mode}
                      onPress={() => setThemeMode(mode)}
                      style={[
                        styles.toggleOption,
                        {
                          backgroundColor: themeMode === mode ? colors.primary : "transparent",
                          borderRadius: 8,
                        },
                      ]}
                    >
                      <Text style={{ color: themeMode === mode ? "#fff" : colors.mutedForeground, fontSize: 12, fontWeight: "500" as const }}>
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              }
              last
            />
          </View>
        </View>

        {/* Reader */}
        <View style={styles.section}>
          <SectionLabel title="Reader" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <SettingRow
              icon="phone-portrait-outline"
              label="Reading Mode"
              description={readerSettings.readingMode === "vertical" ? "Vertical Scroll" : "Horizontal Pages"}
              right={
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => updateReaderSettings({ readingMode: "vertical" })}
                    style={[styles.toggleOption, { backgroundColor: readerSettings.readingMode === "vertical" ? colors.primary : "transparent", borderRadius: 8 }]}
                  >
                    <Text style={{ color: readerSettings.readingMode === "vertical" ? "#fff" : colors.mutedForeground, fontSize: 12, fontWeight: "500" as const }}>
                      Vertical
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => updateReaderSettings({ readingMode: "horizontal" })}
                    style={[styles.toggleOption, { backgroundColor: readerSettings.readingMode === "horizontal" ? colors.primary : "transparent", borderRadius: 8 }]}
                  >
                    <Text style={{ color: readerSettings.readingMode === "horizontal" ? "#fff" : colors.mutedForeground, fontSize: 12, fontWeight: "500" as const }}>
                      Horizontal
                    </Text>
                  </Pressable>
                </View>
              }
            />
            <SettingRow
              icon="phone-portrait-outline"
              label="Show Page Number"
              right={
                <Switch
                  value={readerSettings.showPageNumber}
                  onValueChange={(v) => updateReaderSettings({ showPageNumber: v })}
                  trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                  thumbColor={readerSettings.showPageNumber ? colors.primary : colors.mutedForeground}
                />
              }
              last
            />
          </View>
        </View>

        {/* Data */}
        <View style={styles.section}>
          <SectionLabel title="Data & Performance" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <SettingRow
              icon="speedometer-outline"
              label="Data Saver"
              description="Use compressed images to save bandwidth"
              right={
                <Switch
                  value={readerSettings.dataSaver}
                  onValueChange={(v) => updateReaderSettings({ dataSaver: v })}
                  trackColor={{ false: colors.border, true: `${colors.primary}80` }}
                  thumbColor={readerSettings.dataSaver ? colors.primary : colors.mutedForeground}
                />
              }
            />
            <SettingRow
              icon="layers-outline"
              label="Translation Cache"
              description={cacheSize > 0 ? `${cacheSize} page${cacheSize !== 1 ? "s" : ""} saved offline` : "No cached pages"}
              right={
                cacheSize > 0 ? (
                  <Pressable
                    onPress={handleClearCache}
                    disabled={clearingCache}
                    style={[styles.clearCacheBtn, { borderColor: "#ef4444", opacity: clearingCache ? 0.5 : 1 }]}
                  >
                    {clearingCache ? (
                      <ActivityIndicator size="small" color="#ef4444" />
                    ) : (
                      <Text style={{ color: "#ef4444", fontSize: 12, fontWeight: "600" as const }}>Clear</Text>
                    )}
                  </Pressable>
                ) : null
              }
              last
            />
          </View>
        </View>

        {/* AI Translation */}
        <View style={styles.section}>
          <SectionLabel title="AI Translation" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <SettingRow
              icon="language-outline"
              label="Target Language"
              description={LANGUAGES.find((l) => l.code === readerSettings.targetLanguage)?.label}
            />
            <View style={styles.langGrid}>
              {LANGUAGES.map((lang) => {
                const active = lang.code === readerSettings.targetLanguage;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => updateReaderSettings({ targetLanguage: lang.code as never })}
                    style={[styles.langPill, { backgroundColor: active ? colors.primary : colors.muted, borderRadius: 10 }]}
                  >
                    <Text style={[styles.langText, { color: active ? "#fff" : colors.mutedForeground }]}>
                      {lang.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        {/* Gemini API Keys */}
        <View style={styles.section}>
          <SectionLabel title="Gemini API Keys" />
          <Text style={[styles.keysSubtitle, { color: colors.mutedForeground }]}>
            Add your own keys (up to 5) to bypass rate limits. Tap a key to activate it.
          </Text>

          {tokens.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
              {tokens.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  isActive={token.id === activeTokenId}
                  onActivate={() => setActiveToken(token.id)}
                  onRemove={() => handleRemoveToken(token.id)}
                  onClearLimit={() => clearRateLimit(token.id)}
                />
              ))}
            </View>
          )}

          {tokens.length === 0 && !showAddPanel && (
            <View style={[styles.emptyKeys, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="key-outline" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyKeysText, { color: colors.mutedForeground }]}>
                No API keys added yet.{"\n"}Add a key to unlock unlimited translations.
              </Text>
            </View>
          )}

          {showAddPanel ? (
            <>
              <AddKeyPanel onAdd={handleAddKey} colors={colors} />
              <Pressable onPress={() => setShowAddPanel(false)} style={styles.cancelBtn}>
                <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            tokens.length < 5 && (
              <Pressable
                onPress={() => setShowAddPanel(true)}
                style={[styles.addKeyBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={[styles.addKeyBtnText, { color: colors.primary }]}>
                  Add Key ({tokens.length}/5)
                </Text>
              </Pressable>
            )
          )}
        </View>

        {/* Inpaint Server */}
        <View style={styles.section}>
          <SectionLabel title="Inpaint Server" />
          <Text style={[styles.keysSubtitle, { color: colors.mutedForeground }]}>
            Connect your own private OpenCV inpainting backend hosted on Hugging Face Spaces for faster, decentralized processing.
          </Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius, padding: 14, gap: 10 }]}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Server URL</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={serverUrlInput}
                onChangeText={(v) => { setServerUrlInput(v); setPingStatus("idle"); }}
                placeholder="https://your-space.hf.space"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Pressable
                onPress={handleCheckServer}
                disabled={pingStatus === "checking" || !serverUrlInput.trim()}
                style={[
                  styles.pingBtn,
                  { backgroundColor: colors.muted, borderColor: colors.border, opacity: serverUrlInput.trim() ? 1 : 0.4 },
                ]}
              >
                {pingStatus === "checking" ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="wifi-outline" size={18} color={colors.primary} />
                )}
              </Pressable>
            </View>

            {pingStatus !== "idle" && (
              <View style={styles.pingBadgeRow}>
                <View style={[
                  styles.pingDot,
                  { backgroundColor: pingStatus === "online" ? "#22c55e" : pingStatus === "checking" ? colors.primary : "#ef4444" },
                ]} />
                <Text style={[styles.pingBadgeText, {
                  color: pingStatus === "online" ? "#22c55e" : pingStatus === "checking" ? colors.primary : "#ef4444",
                }]}>
                  {pingStatus === "online" ? "● Active" : pingStatus === "checking" ? "Checking…" : "● Offline / Building"}
                </Text>
              </View>
            )}

            <Pressable
              onPress={handleSaveServerUrl}
              disabled={serverUrlSaving || !serverUrlInput.trim()}
              style={[
                styles.addBtn,
                {
                  backgroundColor: serverUrlInput.trim() ? colors.primary : colors.muted,
                  opacity: serverUrlSaving ? 0.7 : 1,
                },
              ]}
            >
              {serverUrlSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.addBtnText}>Save Server URL</Text>
              )}
            </Pressable>
          </View>

          <Pressable
            onPress={handleOpenHFDeploy}
            style={[
              styles.deployBtn,
              { backgroundColor: `${colors.primary}18`, borderColor: colors.primary },
            ]}
          >
            <Ionicons name="rocket-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.deployBtnTitle, { color: colors.primary }]}>
                Create Your Free Inpaint Server
              </Text>
              <Text style={[styles.deployBtnSub, { color: colors.mutedForeground }]}>
                One-click deploy on Hugging Face Spaces
              </Text>
            </View>
            <Ionicons name="open-outline" size={16} color={colors.primary} />
          </Pressable>
        </View>

        {/* Debug */}
        <View style={styles.section}>
          <SectionLabel title="Debug — CV Pipeline" />
          <Text style={[styles.keysSubtitle, { color: colors.mutedForeground }]}>
            Last {Math.min(debugEntries.length, 5)} CV pipeline events recorded from the manga reader. Open a translated chapter page to capture new events.
          </Text>

          {debugEntries.length === 0 ? (
            <View style={[styles.debugEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="pulse-outline" size={24} color={colors.mutedForeground} />
              <Text style={[styles.debugEmptyText, { color: colors.mutedForeground }]}>
                No events yet.{"\n"}Open a chapter with AI translation enabled.
              </Text>
            </View>
          ) : (
            debugEntries.map((entry) => {
              const isSuccess = entry.status === "success";
              const isPending = entry.status === "pending";
              const isError = entry.status === "fallback_error";
              const dotColor = isSuccess ? "#22c55e" : isPending ? colors.primary : "#ef4444";
              const age = Math.round((Date.now() - entry.ts) / 1000);
              const ageStr = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;

              return (
                <View
                  key={entry.id}
                  style={[styles.debugCard, { backgroundColor: colors.card, borderColor: isError ? "#ef444440" : colors.border }]}
                >
                  {/* Status header */}
                  <View style={styles.debugRow}>
                    <View style={[styles.debugDot, { backgroundColor: dotColor }]} />
                    <Text style={[styles.debugStatus, { color: dotColor }]}>
                      {entry.status === "success" ? "CV PIPELINE ✓" :
                       entry.status === "pending" ? "PENDING…" :
                       entry.status === "fallback_no_regions" ? "FALLBACK — no regions" :
                       entry.status === "fallback_null" ? "FALLBACK — null result" :
                       "FALLBACK — error"}
                    </Text>
                    <Text style={[styles.debugAge, { color: colors.mutedForeground }]}>{ageStr}</Text>
                  </View>

                  {/* Fields */}
                  <View style={styles.debugFields}>
                    <DebugField label="CV_PIPELINE_USED" value={String(entry.cvPipelineUsed)} colors={colors} />
                    <DebugField label="FALLBACK_RENDERER_USED" value={String(entry.fallbackRendererUsed)} colors={colors} />
                    <DebugField label="apiBase" value={entry.apiBase || "(empty — will cause Invalid URL on device)"} colors={colors} highlight={!entry.apiBase} />
                    <DebugField label="INPAINTED_IMAGE_BYTES" value={entry.inpaintedImageBytes > 0 ? `${entry.inpaintedImageBytes.toLocaleString()} bytes` : "0"} colors={colors} />
                    {entry.refinedRegions !== null && (
                      <DebugField label="refinedRegions" value={String(entry.refinedRegions)} colors={colors} />
                    )}
                    {entry.error && (
                      <DebugField label="error" value={entry.error} colors={colors} highlight />
                    )}
                    {entry.reason && (
                      <DebugField label="reason" value={entry.reason} colors={colors} />
                    )}
                    <DebugField label="page" value={entry.page} colors={colors} mono />
                  </View>
                </View>
              );
            })
          )}

          {debugEntries.length > 0 && (
            <Pressable
              onPress={() => { clearCvDebugEntries(); setDebugEntries([]); }}
              style={[styles.clearCacheBtn, { borderColor: colors.border, alignSelf: "flex-end" as const }]}
            >
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600" as const }}>Clear</Text>
            </Pressable>
          )}
        </View>

        {/* About */}
        <View style={styles.section}>
          <SectionLabel title="About" />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius }]}>
            <SettingRow
              icon="information-circle-outline"
              label="MangaVerse"
              description="Version 1.0.0"
              right={null}
              last
            />
          </View>
          <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
            MangaVerse aggregates content from legal public sources including MangaDex. All content is provided in accordance with the respective platform's Terms of Service.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "600" as const },
  section: { paddingHorizontal: 16, marginBottom: 20, gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: "700" as const, letterSpacing: 1 },
  card: { borderWidth: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  iconBox: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowMiddle: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15 },
  rowDesc: { fontSize: 12 },
  toggleRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  toggleOption: { paddingHorizontal: 10, paddingVertical: 5 },
  langGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  langPill: { paddingHorizontal: 14, paddingVertical: 7 },
  langText: { fontSize: 13, fontWeight: "500" as const },
  keysSubtitle: { fontSize: 12, lineHeight: 17 },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  tokenMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  tokenDot: { width: 10, height: 10, borderRadius: 5 },
  tokenLabel: { fontSize: 14, fontWeight: "500" as const },
  tokenKey: { fontSize: 11, fontFamily: "monospace" },
  tokenStatus: { fontSize: 11, fontWeight: "600" as const },
  tokenActions: { flexDirection: "row", gap: 4 },
  tokenActionBtn: { padding: 8 },
  emptyKeys: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyKeysText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  addKeyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    borderStyle: "dashed" as const,
  },
  addKeyBtnText: { fontSize: 14, fontWeight: "600" as const },
  addPanel: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  addPanelTitle: { fontSize: 15, fontWeight: "600" as const, marginBottom: 2 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  addBtn: {
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  addBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" as const },
  cancelBtn: { alignItems: "center", paddingVertical: 10 },
  cancelBtnText: { fontSize: 13 },
  clearCacheBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    minWidth: 56,
    height: 32,
  },
  disclaimer: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  deployBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  deployBtnTitle: { fontSize: 14, fontWeight: "600" as const },
  deployBtnSub: { fontSize: 11, marginTop: 2 },
  pingBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pingBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 2,
  },
  pingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pingBadgeText: { fontSize: 12, fontWeight: "600" as const },
  debugEmpty: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    alignItems: "center" as const,
    gap: 10,
  },
  debugEmptyText: { fontSize: 13, textAlign: "center" as const, lineHeight: 19 },
  debugCard: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden" as const,
    marginBottom: 8,
  },
  debugRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  debugDot: { width: 8, height: 8, borderRadius: 4 },
  debugStatus: { fontSize: 12, fontWeight: "700" as const, flex: 1 },
  debugAge: { fontSize: 11 },
  debugFields: { paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
  debugFieldRow: {
    flexDirection: "row" as const,
    gap: 8,
    alignItems: "flex-start" as const,
  },
  debugFieldLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    width: 130,
    flexShrink: 0,
    paddingTop: 1,
    letterSpacing: 0.3,
  },
  debugFieldValue: {
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
});
