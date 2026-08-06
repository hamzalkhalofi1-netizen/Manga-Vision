/**
 * GeminiKeyCard — rich individual API key card.
 * Shows status, model, stats, cooldown timer, and all key actions.
 * Does NOT touch translation logic.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useTokens, maskKey, type GeminiToken } from "@/context/TokenContext";
import { type KeyTestResult } from "@/services/geminiKeyTest";

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(ts: number | null): string {
  if (!ts) return "Never";
  const delta = Date.now() - ts;
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function formatCooldown(ms: number): string {
  if (ms <= 0) return "0s";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1_000);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

async function copyText(text: string, label = "Copied"): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      Alert.alert(label, "Copied to clipboard.");
    } else {
      Alert.alert("Key", text, [{ text: "Close", style: "cancel" }]);
    }
  } catch {
    Alert.alert("Key", text, [{ text: "Close", style: "cancel" }]);
  }
}

// ── Status colours ─────────────────────────────────────────────────────────────

function statusMeta(token: GeminiToken, isActive: boolean): {
  color: string; label: string; dot: string;
} {
  const now = Date.now();
  if (token.isRateLimited && token.rateLimitedUntil && now < token.rateLimitedUntil) {
    return { color: "#f87171", label: "Cooldown", dot: "#f87171" };
  }
  if (isActive) return { color: "#22c55e", label: "Active", dot: "#22c55e" };
  return { color: "#737373", label: "Available", dot: "#737373" };
}

// ── Test badge ─────────────────────────────────────────────────────────────────

function TestBadge({ result, colors }: { result: KeyTestResult | null; colors: ReturnType<typeof useColors> }) {
  if (!result) return null;
  const ok = result.ok;
  const bg = ok ? "#16a34a18" : "#ef444418";
  const border = ok ? "#16a34a" : "#ef4444";
  const text = ok
    ? `✓ Valid${result.supportedModel ? ` · ${result.supportedModel.replace("gemini-", "").replace("-", " ")}` : ""} · ${result.latencyMs}ms`
    : `✗ ${result.error ?? "Invalid key"}`;

  return (
    <View style={[styles.testBadge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.testBadgeText, { color: border }]} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

// ── Action button ──────────────────────────────────────────────────────────────

function ActionBtn({
  icon,
  label,
  onPress,
  color,
  loading,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  color?: string;
  loading?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      {loading ? (
        <ActivityIndicator size={14} color={color ?? colors.primary} />
      ) : (
        <Ionicons name={icon as never} size={15} color={color ?? colors.mutedForeground} />
      )}
      <Text style={[styles.actionLabel, { color: color ?? colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface GeminiKeyCardProps {
  token: GeminiToken;
  isActive: boolean;
}

export function GeminiKeyCard({ token, isActive }: GeminiKeyCardProps) {
  const colors = useColors();
  const {
    setActiveToken,
    removeToken,
    renameToken,
    editTokenKey,
    clearRateLimit,
    testToken,
  } = useTokens();

  // ── Local state ───────────────────────────────────────────────────────────────

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(token.label);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [editKeyValue, setEditKeyValue] = useState("");
  const [editKeyError, setEditKeyError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "loading">("idle");
  const [testResult, setTestResult] = useState<KeyTestResult | null>(null);
  const renameRef = useRef<TextInput>(null);

  // ── Cooldown countdown ────────────────────────────────────────────────────────

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const isOnCooldown =
      token.isRateLimited && token.rateLimitedUntil && token.rateLimitedUntil > Date.now();
    if (!isOnCooldown) return;
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [token.isRateLimited, token.rateLimitedUntil]);

  const cooldownMs =
    token.isRateLimited && token.rateLimitedUntil && token.rateLimitedUntil > now
      ? token.rateLimitedUntil - now
      : null;

  // ── Entry animation ───────────────────────────────────────────────────────────

  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleActivate = useCallback(() => {
    if (!isActive && !cooldownMs) setActiveToken(token.id);
  }, [isActive, cooldownMs, setActiveToken, token.id]);

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== token.label) renameToken(token.id, trimmed);
    setIsRenaming(false);
  }, [renameValue, token.id, token.label, renameToken]);

  const handleEditKeySubmit = useCallback(async () => {
    const trimmed = editKeyValue.trim();
    if (!trimmed) return;
    const result = await editTokenKey(token.id, trimmed);
    if (result.ok) {
      setIsEditingKey(false);
      setEditKeyValue("");
      setEditKeyError(null);
      setTestResult(null);
    } else {
      setEditKeyError(result.error ?? "Could not update key.");
    }
  }, [editKeyValue, editTokenKey, token.id]);

  const handleTest = useCallback(async () => {
    setTestState("loading");
    setTestResult(null);
    const result = await testToken(token.id);
    setTestResult(result);
    setTestState("idle");
  }, [testToken, token.id]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Key",
      `Remove "${token.label}" permanently?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => removeToken(token.id) },
      ]
    );
  }, [token.id, token.label, removeToken]);

  const handleCopy = useCallback(() => {
    copyText(token.key, "Key Copied");
  }, [token.key]);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const status = statusMeta(token, isActive);
  const modelBadge = token.detectedModel
    ? token.detectedModel.replace("gemini-", "").replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  const borderColor = isActive
    ? `${colors.primary}60`
    : cooldownMs
    ? "#f8717140"
    : colors.border;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor,
          opacity: fadeAnim,
        },
      ]}
    >
      {/* ── Top row: status dot + label + badges ── */}
      <Pressable onPress={handleActivate} style={styles.topRow}>
        <View style={[styles.dot, { backgroundColor: status.dot }]} />

        {isRenaming ? (
          <TextInput
            ref={renameRef}
            value={renameValue}
            onChangeText={setRenameValue}
            onSubmitEditing={handleRenameSubmit}
            onBlur={handleRenameSubmit}
            autoFocus
            style={[styles.renameInput, { color: colors.foreground, borderColor: colors.primary }]}
            returnKeyType="done"
          />
        ) : (
          <Text style={[styles.label, { color: colors.foreground }]} numberOfLines={1}>
            {token.label}
          </Text>
        )}

        <View style={styles.badges}>
          {modelBadge && (
            <View style={[styles.badge, { backgroundColor: `${colors.primary}18` }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{modelBadge}</Text>
            </View>
          )}
          <View style={[styles.badge, { backgroundColor: `${status.dot}18` }]}>
            <Text style={[styles.badgeText, { color: status.dot }]}>{status.label}</Text>
          </View>
        </View>
      </Pressable>

      {/* Masked key */}
      <Text style={[styles.maskedKey, { color: colors.mutedForeground }]}>
        {maskKey(token.key)}
      </Text>

      {/* ── Cooldown bar ── */}
      {cooldownMs !== null && (
        <View style={[styles.cooldownRow, { borderTopColor: colors.border }]}>
          <Ionicons name="time-outline" size={13} color="#f87171" />
          <Text style={styles.cooldownText}>
            Resets in {formatCooldown(cooldownMs)}
          </Text>
          <Pressable onPress={() => clearRateLimit(token.id)} style={styles.resetBtn}>
            <Ionicons name="refresh" size={13} color={colors.primary} />
            <Text style={[styles.resetBtnText, { color: colors.primary }]}>Reset</Text>
          </Pressable>
        </View>
      )}

      {/* ── Stats row ── */}
      {cooldownMs === null && (
        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
          <StatCell icon="time-outline" label="Last used" value={timeAgo(token.lastUsed)} colors={colors} />
          <StatDivider colors={colors} />
          <StatCell
            icon="speedometer-outline"
            label="Latency"
            value={token.latencyMs !== null ? `${token.latencyMs}ms` : "—"}
            colors={colors}
          />
          <StatDivider colors={colors} />
          <StatCell
            icon="swap-horizontal-outline"
            label="Calls"
            value={token.requestCount > 0 ? String(token.requestCount) : "—"}
            colors={colors}
          />
        </View>
      )}

      {/* ── Test result ── */}
      {testResult && <TestBadge result={testResult} colors={colors} />}

      {/* ── Edit key form ── */}
      {isEditingKey && (
        <View style={[styles.editKeyForm, { borderTopColor: colors.border }]}>
          <Text style={[styles.editKeyLabel, { color: colors.mutedForeground }]}>New API Key</Text>
          <View style={styles.editKeyRow}>
            <TextInput
              value={editKeyValue}
              onChangeText={(v) => { setEditKeyValue(v); setEditKeyError(null); }}
              placeholder="Paste new key…"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={[
                styles.editKeyInput,
                {
                  color: colors.foreground,
                  borderColor: editKeyError ? "#ef4444" : colors.border,
                  backgroundColor: colors.muted,
                },
              ]}
            />
            <Pressable
              onPress={handleEditKeySubmit}
              disabled={!editKeyValue.trim()}
              style={[
                styles.editKeySave,
                { backgroundColor: editKeyValue.trim() ? colors.primary : colors.muted },
              ]}
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
            </Pressable>
          </View>
          {editKeyError && (
            <Text style={styles.editKeyError}>{editKeyError}</Text>
          )}
        </View>
      )}

      {/* ── Action buttons ── */}
      <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
        <ActionBtn
          icon="flask-outline"
          label="Test"
          onPress={handleTest}
          loading={testState === "loading"}
          color={colors.primary}
        />
        <ActionBtn icon="copy-outline" label="Copy" onPress={handleCopy} />
        <ActionBtn
          icon="pencil-outline"
          label="Rename"
          onPress={() => {
            setRenameValue(token.label);
            setIsRenaming(true);
            setTimeout(() => renameRef.current?.focus(), 50);
          }}
        />
        <ActionBtn
          icon="key-outline"
          label="Edit Key"
          onPress={() => setIsEditingKey((v) => !v)}
          color={isEditingKey ? colors.primary : undefined}
        />
        <ActionBtn icon="trash-outline" label="Delete" onPress={handleDelete} color="#f87171" />
      </View>
    </Animated.View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCell({
  icon, label, value, colors,
}: {
  icon: string; label: string; value: string; colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.statCell}>
      <Ionicons name={icon as never} size={11} color={colors.mutedForeground} />
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function StatDivider({ colors }: { colors: ReturnType<typeof useColors> }) {
  return <View style={[styles.statDivider, { backgroundColor: colors.border }]} />;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 4,
    gap: 8,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    flexShrink: 0,
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600" as const,
  },
  badges: {
    flexDirection: "row",
    gap: 5,
    flexShrink: 0,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600" as const,
    textTransform: "capitalize" as const,
  },
  maskedKey: {
    fontSize: 11,
    fontFamily: "monospace",
    paddingHorizontal: 14,
    paddingBottom: 10,
    letterSpacing: 0.5,
  },
  // Rename input
  renameInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600" as const,
    borderBottomWidth: 1,
    paddingVertical: 2,
  },
  // Cooldown
  cooldownRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  cooldownText: {
    flex: 1,
    fontSize: 12,
    color: "#f87171",
    fontWeight: "500" as const,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resetBtnText: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  // Stats
  statsRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 4,
  },
  statCell: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statLabel: {
    fontSize: 9,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: 4,
  },
  // Test badge
  testBadge: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  testBadgeText: {
    fontSize: 11,
    fontWeight: "500" as const,
  },
  // Edit key
  editKeyForm: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  editKeyLabel: {
    fontSize: 11,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  editKeyRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  editKeyInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 12,
    fontFamily: "monospace",
  },
  editKeySave: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  editKeyError: {
    fontSize: 11,
    color: "#ef4444",
  },
  // Actions
  actionsRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 6,
  },
  actionLabel: {
    fontSize: 9,
    fontWeight: "500" as const,
  },
});
