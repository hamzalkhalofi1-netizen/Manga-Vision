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
import {
  getCvDebugEntries,
  clearCvDebugEntries,
  subscribeCvDebug,
  type CvDebugEntry,
} from "@/services/cvDebugStore";
import {
  SettingsSection,
  SettingsItem,
  SettingsToggle,
  SettingsOptionSelector,
} from "@/components/settings";

// ─── Constants ────────────────────────────────────────────────────────────────

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

const THEME_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const READING_MODE_OPTIONS = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
];

// ─── Local sub-components (unchanged logic, used inside sections) ─────────────

function TokenRow({
  token,
  isActive,
  onActivate,
  onRemove,
  onClearLimit,
}: {
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
          { backgroundColor: isActive ? colors.primary : isRateLimited ? "#f87171" : colors.border },
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

function AddKeyPanel({
  onAdd,
  colors,
}: {
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

// ─── Placeholder for empty sections ──────────────────────────────────────────

function ComingSoonPlaceholder({ message }: { message: string }) {
  const colors = useColors();
  return (
    <View style={[styles.placeholder, { borderColor: colors.border }]}>
      <Ionicons name="construct-outline" size={22} color={colors.mutedForeground} />
      <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>{message}</Text>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { readerSettings, updateReaderSettings, themeMode, setThemeMode } = useSettings();
  const { tokens, activeTokenId, addToken, removeToken, setActiveToken, clearRateLimit } = useTokens();
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

  useEffect(() => {
    if (serverUrl) setServerUrlInput(serverUrl);
  }, [serverUrl]);

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

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* ── Scrollable sections ────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{ paddingTop: 8, paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── 1. Reader ─────────────────────────────────────────────────── */}
        <SettingsSection title="Reader" icon="book-outline" defaultExpanded>
          <SettingsItem
            icon="phone-portrait-outline"
            label="Reading Mode"
            description={
              readerSettings.readingMode === "vertical"
                ? "Vertical scroll"
                : "Horizontal pages"
            }
            noChevron
            right={
              <SettingsOptionSelector
                options={READING_MODE_OPTIONS}
                selected={readerSettings.readingMode}
                onChange={(v) => updateReaderSettings({ readingMode: v as "vertical" | "horizontal" })}
                layout="row"
              />
            }
          />
          <SettingsItem
            icon="layers-outline"
            label="Show Page Number"
            description="Display current page index while reading"
            last
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.showPageNumber}
                onValueChange={(v) => updateReaderSettings({ showPageNumber: v })}
              />
            }
          />
        </SettingsSection>

        <SectionSpacer />

        {/* ── 2. AI Translation ─────────────────────────────────────────── */}
        <SettingsSection
          title="AI Translation"
          icon="language-outline"
          defaultExpanded
          badge={tokens.length > 0 ? tokens.length : undefined}
        >
          {/* Target language */}
          <SettingsItem
            icon="globe-outline"
            label="Target Language"
            description={LANGUAGES.find((l) => l.code === readerSettings.targetLanguage)?.label}
            noChevron
            right={null}
          />
          <SettingsOptionSelector
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            selected={readerSettings.targetLanguage}
            onChange={(v) => updateReaderSettings({ targetLanguage: v as never })}
            layout="wrap"
          />

          {/* Gemini API Keys sub-section */}
          <View style={[styles.subHeader, { borderTopColor: colors.border }]}>
            <Ionicons name="key-outline" size={13} color={colors.mutedForeground} />
            <Text style={[styles.subHeaderText, { color: colors.mutedForeground }]}>
              Gemini API Keys — add your own (up to 5) to bypass rate limits
            </Text>
          </View>

          {tokens.length === 0 && !showAddPanel ? (
            <View style={[styles.emptyKeys, { borderTopColor: colors.border }]}>
              <Ionicons name="key-outline" size={24} color={colors.mutedForeground} />
              <Text style={[styles.emptyKeysText, { color: colors.mutedForeground }]}>
                No API keys added yet.{"\n"}Add a key to unlock unlimited translations.
              </Text>
            </View>
          ) : (
            tokens.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                isActive={token.id === activeTokenId}
                onActivate={() => setActiveToken(token.id)}
                onRemove={() => handleRemoveToken(token.id)}
                onClearLimit={() => clearRateLimit(token.id)}
              />
            ))
          )}

          {showAddPanel ? (
            <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
              <AddKeyPanel onAdd={handleAddKey} colors={colors} />
              <Pressable onPress={() => setShowAddPanel(false)} style={styles.cancelBtn}>
                <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            tokens.length < 5 && (
              <Pressable
                onPress={() => setShowAddPanel(true)}
                style={[styles.addKeyRow, { borderTopColor: colors.border }]}
              >
                <View style={[styles.addKeyIconWrap, { backgroundColor: `${colors.primary}1A` }]}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.addKeyBtnText, { color: colors.primary }]}>
                  Add Key ({tokens.length}/5)
                </Text>
              </Pressable>
            )
          )}
        </SettingsSection>

        <SectionSpacer />

        {/* ── 3. Fonts & Appearance ─────────────────────────────────────── */}
        <SettingsSection title="Fonts & Appearance" icon="color-palette-outline" defaultExpanded>
          <SettingsItem
            icon="contrast-outline"
            label="Theme"
            description={
              themeMode === "auto"
                ? "Follows system setting"
                : themeMode === "dark"
                ? "Always dark"
                : "Always light"
            }
            noChevron
            last
            right={
              <SettingsOptionSelector
                options={THEME_OPTIONS}
                selected={themeMode}
                onChange={(v) => setThemeMode(v as ThemeMode)}
                layout="row"
              />
            }
          />
        </SettingsSection>

        <SectionSpacer />

        {/* ── 4. Sources ────────────────────────────────────────────────── */}
        <SettingsSection
          title="Sources"
          icon="server-outline"
          defaultExpanded={false}
          subtitle="Manage manga source preferences"
        >
          <View style={{ paddingHorizontal: 14, paddingVertical: 20 }}>
            <ComingSoonPlaceholder message="Source-specific settings coming soon.{'\n'}Switch sources from the Home screen." />
          </View>
        </SettingsSection>

        <SectionSpacer />

        {/* ── 5. Data & Performance ─────────────────────────────────────── */}
        <SettingsSection title="Data & Performance" icon="speedometer-outline" defaultExpanded>
          <SettingsItem
            icon="cellular-outline"
            label="Data Saver"
            description="Use compressed images to save bandwidth"
            noChevron
            right={
              <SettingsToggle
                value={readerSettings.dataSaver}
                onValueChange={(v) => updateReaderSettings({ dataSaver: v })}
              />
            }
          />
          <SettingsItem
            icon="archive-outline"
            label="Translation Cache"
            description={
              cacheSize > 0
                ? `${cacheSize} page${cacheSize !== 1 ? "s" : ""} saved offline`
                : "No cached pages"
            }
            last
            noChevron
            right={
              cacheSize > 0 ? (
                <Pressable
                  onPress={handleClearCache}
                  disabled={clearingCache}
                  style={[
                    styles.clearCacheBtn,
                    { borderColor: "#ef4444", opacity: clearingCache ? 0.5 : 1 },
                  ]}
                >
                  {clearingCache ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Text style={{ color: "#ef4444", fontSize: 12, fontWeight: "600" as const }}>Clear</Text>
                  )}
                </Pressable>
              ) : null
            }
          />
        </SettingsSection>

        {/* Debug CV Pipeline — inside Data & Performance conceptually but separate card */}
        <View style={[styles.debugSection, { paddingHorizontal: 16 }]}>
          <SettingsSection
            title="CV Pipeline Debug"
            icon="pulse-outline"
            defaultExpanded={false}
            subtitle={`${Math.min(debugEntries.length, 5)} recent events`}
          >
            {debugEntries.length === 0 ? (
              <View style={[styles.debugEmpty, { borderTopColor: colors.border }]}>
                <Ionicons name="pulse-outline" size={22} color={colors.mutedForeground} />
                <Text style={[styles.debugEmptyText, { color: colors.mutedForeground }]}>
                  No events yet.{"\n"}Open a chapter with AI translation enabled.
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8, paddingTop: 4 }}>
                {debugEntries.map((entry) => {
                  const isSuccess = entry.status === "success";
                  const isPending = entry.status === "pending";
                  const isError = entry.status === "fallback_error";
                  const dotColor = isSuccess ? "#22c55e" : isPending ? colors.primary : "#ef4444";
                  const age = Math.round((Date.now() - entry.ts) / 1000);
                  const ageStr = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;

                  return (
                    <View
                      key={entry.id}
                      style={[
                        styles.debugCard,
                        {
                          backgroundColor: colors.background,
                          borderColor: isError ? "#ef444440" : colors.border,
                        },
                      ]}
                    >
                      <View style={styles.debugRow}>
                        <View style={[styles.debugDot, { backgroundColor: dotColor }]} />
                        <Text style={[styles.debugStatus, { color: dotColor }]}>
                          {entry.status === "success"
                            ? "CV PIPELINE ✓"
                            : entry.status === "pending"
                            ? "PENDING…"
                            : entry.status === "fallback_no_regions"
                            ? "FALLBACK — no regions"
                            : entry.status === "fallback_null"
                            ? "FALLBACK — null result"
                            : "FALLBACK — error"}
                        </Text>
                        <Text style={[styles.debugAge, { color: colors.mutedForeground }]}>{ageStr}</Text>
                      </View>
                      <View style={styles.debugFields}>
                        <DebugField label="CV_PIPELINE_USED" value={String(entry.cvPipelineUsed)} colors={colors} />
                        <DebugField label="FALLBACK_RENDERER_USED" value={String(entry.fallbackRendererUsed)} colors={colors} />
                        <DebugField
                          label="apiBase"
                          value={entry.apiBase || "(empty — will cause Invalid URL on device)"}
                          colors={colors}
                          highlight={!entry.apiBase}
                        />
                        <DebugField
                          label="INPAINTED_IMAGE_BYTES"
                          value={entry.inpaintedImageBytes > 0 ? `${entry.inpaintedImageBytes.toLocaleString()} bytes` : "0"}
                          colors={colors}
                        />
                        {entry.refinedRegions !== null && (
                          <DebugField label="refinedRegions" value={String(entry.refinedRegions)} colors={colors} />
                        )}
                        {entry.error && <DebugField label="error" value={entry.error} colors={colors} highlight />}
                        {entry.reason && <DebugField label="reason" value={entry.reason} colors={colors} />}
                        <DebugField label="page" value={entry.page} colors={colors} mono />
                      </View>
                    </View>
                  );
                })}

                <Pressable
                  onPress={() => { clearCvDebugEntries(); setDebugEntries([]); }}
                  style={[styles.clearCacheBtn, { borderColor: colors.border, alignSelf: "flex-end" as const }]}
                >
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "600" as const }}>
                    Clear
                  </Text>
                </Pressable>
              </View>
            )}
          </SettingsSection>
        </View>

        <SectionSpacer />

        {/* ── 6. Network ────────────────────────────────────────────────── */}
        <SettingsSection
          title="Network"
          icon="wifi-outline"
          defaultExpanded={false}
          subtitle="Inpaint server & connectivity"
        >
          <View style={{ padding: 14, gap: 10 }}>
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Inpaint Server URL</Text>
            <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>
              Connect your private OpenCV inpainting backend hosted on Hugging Face Spaces.
            </Text>

            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={serverUrlInput}
                onChangeText={(v) => { setServerUrlInput(v); setPingStatus("idle"); }}
                placeholder="https://your-space.hf.space"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted },
                ]}
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
                  {
                    backgroundColor:
                      pingStatus === "online" ? "#22c55e"
                      : pingStatus === "checking" ? colors.primary
                      : "#ef4444",
                  },
                ]} />
                <Text
                  style={[
                    styles.pingBadgeText,
                    {
                      color:
                        pingStatus === "online" ? "#22c55e"
                        : pingStatus === "checking" ? colors.primary
                        : "#ef4444",
                    },
                  ]}
                >
                  {pingStatus === "online"
                    ? "● Active"
                    : pingStatus === "checking"
                    ? "Checking…"
                    : "● Offline / Building"}
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

          {/* HF deploy CTA */}
          <Pressable
            onPress={handleOpenHFDeploy}
            style={[styles.deployBtn, { backgroundColor: `${colors.primary}18`, borderColor: colors.primary }]}
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
        </SettingsSection>

        <SectionSpacer />

        {/* ── 7. Backup ─────────────────────────────────────────────────── */}
        <SettingsSection
          title="Backup"
          icon="cloud-upload-outline"
          defaultExpanded={false}
          subtitle="Export and restore your library"
        >
          <View style={{ paddingHorizontal: 14, paddingVertical: 20 }}>
            <ComingSoonPlaceholder message="Library backup & restore coming soon." />
          </View>
        </SettingsSection>

        <SectionSpacer />

        {/* ── 8. About ──────────────────────────────────────────────────── */}
        <SettingsSection title="About" icon="information-circle-outline" defaultExpanded={false}>
          <SettingsItem
            icon="apps-outline"
            label="MangaVerse"
            description="Version 1.0.0"
            noChevron
            right={null}
            last
          />
        </SettingsSection>

        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          MangaVerse aggregates content from legal public sources including MangaDex. All content is
          provided in accordance with the respective platform's Terms of Service.
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Thin spacing between sections ───────────────────────────────────────────

function SectionSpacer() {
  return <View style={{ height: 6 }} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "600" as const },

  // Debug sub-section nesting
  debugSection: { marginBottom: 0 },

  // Inline sub-header (inside AI translation card)
  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  subHeaderText: { fontSize: 11, flex: 1, lineHeight: 15 },

  // Token rows
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
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

  // Empty keys state
  emptyKeys: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyKeysText: { fontSize: 13, textAlign: "center", lineHeight: 19 },

  // Add key row (dashed-style button inside card)
  addKeyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addKeyIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  addKeyBtnText: { fontSize: 14, fontWeight: "600" as const },

  // Add key panel
  addPanel: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  addPanelTitle: { fontSize: 15, fontWeight: "600" as const, marginBottom: 2 },
  cancelBtn: { alignItems: "center", paddingVertical: 10 },
  cancelBtnText: { fontSize: 13 },

  // Shared input
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },

  // Save/add button
  addBtn: {
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  addBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" as const },

  // Cache clear button
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

  // Network / ping
  pingBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pingBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 },
  pingDot: { width: 8, height: 8, borderRadius: 4 },
  pingBadgeText: { fontSize: 12, fontWeight: "600" as const },

  // HF deploy CTA
  deployBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  deployBtnTitle: { fontSize: 14, fontWeight: "600" as const },
  deployBtnSub: { fontSize: 11, marginTop: 2 },

  // Debug
  debugEmpty: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: "center" as const,
    gap: 10,
  },
  debugEmptyText: { fontSize: 13, textAlign: "center" as const, lineHeight: 19 },
  debugCard: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden" as const,
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
  debugFieldRow: { flexDirection: "row" as const, gap: 8, alignItems: "flex-start" as const },
  debugFieldLabel: {
    fontSize: 10,
    fontWeight: "700" as const,
    width: 130,
    flexShrink: 0,
    paddingTop: 1,
    letterSpacing: 0.3,
  },
  debugFieldValue: { fontSize: 11, flex: 1, lineHeight: 16 },

  // Placeholder
  placeholder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    borderStyle: "dashed" as const,
    padding: 20,
    alignItems: "center" as const,
    gap: 8,
  },
  placeholderText: { fontSize: 12, textAlign: "center" as const, lineHeight: 18 },

  // Disclaimer
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginHorizontal: 24,
    marginTop: 16,
  },

  // Shared text helpers (used inside Network section inline JSX)
  rowLabel: { fontSize: 14, fontWeight: "500" as const },
  rowDesc: { fontSize: 12, lineHeight: 17 },
});
