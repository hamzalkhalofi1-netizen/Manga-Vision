import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/context/SettingsContext";
import { useTokens } from "@/context/TokenContext";
import {
  SettingsSection,
  SettingsItem,
  SettingsToggle,
  SettingsOptionSelector,
} from "@/components/settings";
import { GeminiKeyManager } from "@/components/settings/gemini";
import { SettingsSlider } from "@/components/settings/SettingsSlider";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "zh", label: "中文" },
];

const TRANSLATION_STYLES = [
  { value: "literal",      label: "Literal" },
  { value: "natural",      label: "Natural" },
  { value: "professional", label: "Professional" },
  { value: "anime",        label: "Anime Style" },
];

const MODEL_INFO = {
  "gemini-flash-lite-latest": { label: "Gemini Flash-Lite", tag: "⭐ Recommended for Free Tier", color: "#22c55e" },
} as const;

// ── Dashboard card ────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: accent ? `${colors.primary}15` : colors.card,
          borderColor: accent ? `${colors.primary}30` : colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Ionicons name={icon as never} size={16} color={accent ? colors.primary : colors.mutedForeground} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sub ? <Text style={[styles.statSub, { color: colors.mutedForeground }]}>{sub}</Text> : null}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function AITranslationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    readerSettings,
    updateReaderSettings,
    translationSettings,
    updateTranslationSettings,
    translationCount,
    geminiModel,
  } = useSettings();
  const { tokens, activeTokenId } = useTokens();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  const activeToken = useMemo(
    () => tokens.find((t) => t.id === activeTokenId),
    [tokens, activeTokenId]
  );

  const availableKeys = tokens.filter((t) => !t.isRateLimited).length;

  const avgLatency = useMemo(() => {
    const withLatency = tokens.filter((t) => t.latencyMs !== null && t.latencyMs > 0);
    if (!withLatency.length) return null;
    const avg = withLatency.reduce((s, t) => s + (t.latencyMs ?? 0), 0) / withLatency.length;
    return Math.round(avg);
  }, [tokens]);

  const totalRequests = tokens.reduce((s, t) => s + t.requestCount, 0);
  const modelInfo = MODEL_INFO[geminiModel];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>AI Translation</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Dashboard ──────────────────────────────────────────────────── */}
        <View style={styles.dashboardSection}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DASHBOARD</Text>

          {/* Active key + model bar */}
          <View style={[styles.activeBar, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}25`, borderRadius: colors.radius }]}>
            <View style={styles.activeBarLeft}>
              <View style={[styles.activeDot, { backgroundColor: availableKeys > 0 ? "#22c55e" : "#ef4444" }]} />
              <View>
                <Text style={[styles.activeBarLabel, { color: colors.foreground }]}>
                  {activeToken ? (activeToken.label || "Key #1") : "No Active Key"}
                </Text>
                <Text style={[styles.activeBarSub, { color: colors.mutedForeground }]}>
                  {availableKeys}/{tokens.length} keys available · {modelInfo?.label ?? geminiModel}
                </Text>
              </View>
            </View>
            <Ionicons name="sparkles" size={20} color={colors.primary} />
          </View>

          {/* Stats grid */}
          <View style={styles.statsGrid}>
            <StatCard
              icon="document-text-outline"
              label="Total Pages"
              value={String(translationCount)}
              accent
            />
            <StatCard
              icon="key-outline"
              label="API Keys"
              value={`${tokens.length}/10`}
              sub={`${availableKeys} active`}
            />
            <StatCard
              icon="time-outline"
              label="Avg Latency"
              value={avgLatency ? `${avgLatency}ms` : "—"}
            />
            <StatCard
              icon="analytics-outline"
              label="Requests"
              value={totalRequests > 0 ? String(totalRequests) : "—"}
            />
          </View>
        </View>

        {/* ── Gemini Key Manager ────────────────────────────────────────── */}
        <View style={{ marginTop: 6 }}>
          <SettingsSection title="API Keys" icon="key-outline" defaultExpanded>
            <GeminiKeyManager />
          </SettingsSection>
        </View>

        {/* ── Target language ───────────────────────────────────────────── */}
        <View style={{ marginTop: 6 }}>
          <SettingsSection title="Target Language" icon="globe-outline" defaultExpanded>
            <View style={{ padding: 12 }}>
              <SettingsOptionSelector
                options={LANGUAGES}
                selected={readerSettings.targetLanguage}
                onChange={(v) => updateReaderSettings({ targetLanguage: v as never })}
                layout="wrap"
              />
            </View>
          </SettingsSection>
        </View>

        {/* ── Translation style ─────────────────────────────────────────── */}
        <View style={{ marginTop: 6 }}>
          <SettingsSection title="Translation Style" icon="color-wand-outline" defaultExpanded>
            <SettingsItem
              icon="swap-horizontal-outline"
              label="Style"
              description={TRANSLATION_STYLES.find((s) => s.value === translationSettings.style)?.label}
              noChevron
              right={
                <SettingsOptionSelector
                  options={TRANSLATION_STYLES}
                  selected={translationSettings.style}
                  onChange={(v) => updateTranslationSettings({ style: v as never })}
                  layout="row"
                />
              }
            />
          </SettingsSection>
        </View>

        {/* ── Options ───────────────────────────────────────────────────── */}
        <View style={{ marginTop: 6 }}>
          <SettingsSection title="Translation Options" icon="options-outline" defaultExpanded>
            <SettingsItem
              icon="musical-notes-outline"
              label="Translate SFX"
              description="Translate sound effects (BOOM, CRASH, etc.)"
              noChevron
              right={
                <SettingsToggle
                  value={translationSettings.translateSFX}
                  onValueChange={(v) => updateTranslationSettings({ translateSFX: v })}
                />
              }
            />
            <SettingsItem
              icon="megaphone-outline"
              label="Translate Narration"
              description="Translate story narration boxes"
              noChevron
              right={
                <SettingsToggle
                  value={translationSettings.translateNarration}
                  onValueChange={(v) => updateTranslationSettings({ translateNarration: v })}
                />
              }
            />
            <SettingsItem
              icon="person-circle-outline"
              label="Translate Credits"
              description="Translate credits and metadata text"
              noChevron
              right={
                <SettingsToggle
                  value={translationSettings.translateCredits}
                  onValueChange={(v) => updateTranslationSettings({ translateCredits: v })}
                />
              }
            />
            <SettingsItem
              icon="copy-outline"
              label="Keep Original Text"
              description="Show original text below translation"
              noChevron
              right={
                <SettingsToggle
                  value={translationSettings.keepOriginal}
                  onValueChange={(v) => updateTranslationSettings({ keepOriginal: v })}
                />
              }
            />
            <SettingsItem
              icon="refresh-outline"
              label="Auto Retry on Failure"
              description="Retry automatically when translation fails"
              noChevron
              right={
                <SettingsToggle
                  value={translationSettings.autoRetry}
                  onValueChange={(v) => updateTranslationSettings({ autoRetry: v })}
                />
              }
            />
            {translationSettings.autoRetry && (
              <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
                <SettingsSlider
                  label="Maximum Retries"
                  value={translationSettings.maxRetries}
                  min={1}
                  max={5}
                  onChange={(v) => updateTranslationSettings({ maxRetries: v })}
                  unit=" times"
                  presets={[
                    { label: "1×", value: 1 },
                    { label: "3×", value: 3 },
                    { label: "5×", value: 5 },
                  ]}
                />
              </View>
            )}
            <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
              <SettingsSlider
                label="Translation Timeout"
                value={translationSettings.timeoutSeconds}
                min={10}
                max={120}
                step={5}
                onChange={(v) => updateTranslationSettings({ timeoutSeconds: v })}
                unit="s"
                presets={[
                  { label: "15s", value: 15 },
                  { label: "30s", value: 30 },
                  { label: "60s", value: 60 },
                ]}
              />
            </View>
          </SettingsSection>
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
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "600" as const },
  dashboardSection: { paddingHorizontal: 16, gap: 10 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  activeBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderWidth: 1,
  },
  activeBarLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  activeDot: { width: 9, height: 9, borderRadius: 5 },
  activeBarLabel: { fontSize: 14, fontWeight: "600" as const },
  activeBarSub: { fontSize: 11, marginTop: 2 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statCard: {
    flex: 1,
    minWidth: "44%",
    padding: 12,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  statValue: { fontSize: 20, fontWeight: "700" as const },
  statLabel: { fontSize: 10, textAlign: "center" as const },
  statSub: { fontSize: 9, textAlign: "center" as const },
});
