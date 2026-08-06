/**
 * GeminiKeyManager — full key management section.
 * Composes GeminiKeyCard list, add/edit form, auto-rotation toggle,
 * and model selector. Owns all mutation logic so settings.tsx stays thin.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useTokens } from "@/context/TokenContext";
import { detectKeyFormat } from "@/services/geminiKeyTest";
import { GeminiKeyCard } from "./GeminiKeyCard";
import { GeminiModelSelector } from "./GeminiModelSelector";
import { SettingsItem } from "@/components/settings/SettingsItem";
import { SettingsToggle } from "@/components/settings/SettingsToggle";

// ── Format hint indicator ──────────────────────────────────────────────────────

function KeyFormatHint({ raw, colors }: { raw: string; colors: ReturnType<typeof useColors> }) {
  const hint = detectKeyFormat(raw);
  if (hint === "empty") return null;

  const cfg = {
    gemini:     { icon: "checkmark-circle", color: "#16a34a", text: "Gemini API key format detected" },
    plausible:  { icon: "help-circle",      color: "#f59e0b", text: "Unknown format — test to verify" },
    too_short:  { icon: "close-circle",     color: "#ef4444", text: "Key too short (min 20 characters)" },
  }[hint] ?? null;

  if (!cfg) return null;

  return (
    <View style={styles.hintRow}>
      <Ionicons name={cfg.icon as never} size={13} color={cfg.color} />
      <Text style={[styles.hintText, { color: cfg.color }]}>{cfg.text}</Text>
    </View>
  );
}

// ── Add key form ───────────────────────────────────────────────────────────────

function AddKeyForm({
  onClose,
  colors,
}: {
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const { addToken } = useTokens();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    setLoading(true);
    setError(null);
    const result = await addToken(trimmedKey, label.trim() || undefined);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add key.");
    } else {
      onClose();
    }
  };

  return (
    <View style={[styles.addForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.addFormTitle, { color: colors.foreground }]}>Add Gemini API Key</Text>

      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Label (e.g. Personal Key)"
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
      />

      <View style={{ gap: 4 }}>
        <TextInput
          value={key}
          onChangeText={(v) => { setKey(v); setError(null); }}
          placeholder="Paste API key… (AIzaSy…)"
          placeholderTextColor={colors.mutedForeground}
          style={[
            styles.input,
            {
              color: colors.foreground,
              borderColor: error ? "#ef4444" : colors.border,
              backgroundColor: colors.muted,
              fontFamily: "monospace",
            },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <KeyFormatHint raw={key} colors={colors} />
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.addFormActions}>
        <Pressable
          onPress={onClose}
          style={[styles.cancelBtn, { borderColor: colors.border }]}
        >
          <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleAdd}
          disabled={!key.trim() || loading}
          style={[
            styles.saveBtn,
            { backgroundColor: key.trim() ? colors.primary : colors.muted, opacity: loading ? 0.7 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Save Key</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyKeysState({
  colors,
  onAdd,
}: {
  colors: ReturnType<typeof useColors>;
  onAdd: () => void;
}) {
  return (
    <Pressable
      onPress={onAdd}
      style={[styles.emptyState, { borderColor: colors.border }]}
    >
      <View style={[styles.emptyIcon, { backgroundColor: `${colors.primary}14` }]}>
        <Ionicons name="key-outline" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No API Keys Added</Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        Add your Gemini API key to enable AI translation.{"\n"}
        Up to 10 keys — rotate automatically when quota runs out.
      </Text>
      <View style={[styles.emptyAddBtn, { backgroundColor: colors.primary }]}>
        <Ionicons name="add" size={14} color="#fff" />
        <Text style={styles.emptyAddBtnText}>Add First Key</Text>
      </View>
    </Pressable>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function GeminiKeyManager() {
  const colors = useColors();
  const { tokens, activeTokenId, autoRotation, setAutoRotation } = useTokens();
  const [showAddForm, setShowAddForm] = useState(false);

  const availableSlots = 10 - tokens.length;

  return (
    <View style={styles.root}>

      {/* ── Model selector ─────────────────────────────────────────────── */}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
          <Ionicons name="hardware-chip-outline" size={14} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>AI Model</Text>
        </View>
        <GeminiModelSelector />
      </View>

      {/* ── Keys section ───────────────────────────────────────────────── */}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
          <Ionicons name="key-outline" size={14} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            API Keys
          </Text>
          <Text style={[styles.slotBadge, { color: colors.mutedForeground }]}>
            {tokens.length}/10
          </Text>
        </View>

        {/* Auto-rotation toggle */}
        <View style={[styles.autoRotationRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.rotationIconWrap, { backgroundColor: `${colors.primary}14` }]}>
            <Ionicons name="swap-horizontal-outline" size={14} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.rotationLabel, { color: colors.foreground }]}>Auto Key Rotation</Text>
            <Text style={[styles.rotationDesc, { color: colors.mutedForeground }]}>
              Automatically switch to the next available key when quota is exceeded
            </Text>
          </View>
          <SettingsToggle value={autoRotation} onValueChange={setAutoRotation} />
        </View>

        {/* Key cards */}
        <View style={styles.cardList}>
          {tokens.length === 0 && !showAddForm ? (
            <EmptyKeysState colors={colors} onAdd={() => setShowAddForm(true)} />
          ) : (
            tokens.map((token) => (
              <GeminiKeyCard
                key={token.id}
                token={token}
                isActive={token.id === activeTokenId}
              />
            ))
          )}
        </View>

        {/* Add key form or button */}
        {showAddForm ? (
          <AddKeyForm colors={colors} onClose={() => setShowAddForm(false)} />
        ) : (
          tokens.length > 0 && availableSlots > 0 && (
            <Pressable
              onPress={() => setShowAddForm(true)}
              style={[styles.addKeyBtn, { borderColor: colors.border }]}
            >
              <View style={[styles.addKeyIcon, { backgroundColor: `${colors.primary}14` }]}>
                <Ionicons name="add" size={15} color={colors.primary} />
              </View>
              <Text style={[styles.addKeyText, { color: colors.primary }]}>
                Add Key ({availableSlots} slot{availableSlots !== 1 ? "s" : ""} remaining)
              </Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 6,
  },
  section: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600" as const,
  },
  slotBadge: {
    fontSize: 11,
    fontWeight: "500" as const,
  },
  // Auto rotation row
  autoRotationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rotationIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rotationLabel: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  rotationDesc: {
    fontSize: 10,
    lineHeight: 13,
  },
  // Card list
  cardList: {
    padding: 12,
    gap: 0,
  },
  // Empty state
  emptyState: {
    borderWidth: 1,
    borderRadius: 12,
    borderStyle: "dashed" as const,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600" as const,
  },
  emptyBody: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    marginTop: 4,
  },
  emptyAddBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600" as const,
  },
  // Add key button
  addKeyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderStyle: "dashed" as const,
    borderRadius: 10,
  },
  addKeyIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  addKeyText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  // Add form
  addForm: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 12,
  },
  addFormTitle: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  hintText: {
    fontSize: 11,
    fontWeight: "500" as const,
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
  },
  addFormActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  saveBtn: {
    flex: 2,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600" as const,
  },
});
