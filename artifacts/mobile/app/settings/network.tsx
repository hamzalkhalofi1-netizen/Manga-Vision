import { Ionicons } from "@expo/vector-icons";
import { Linking } from "react-native";
import { router } from "expo-router";
import React, { useState } from "react";
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
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/context/SettingsContext";
import { useInpaintServer } from "@/hooks/useInpaintServer";
import {
  SettingsSection,
  SettingsItem,
  SettingsToggle,
} from "@/components/settings";
import { SettingsSlider } from "@/components/settings/SettingsSlider";

export default function NetworkScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { networkSettings, updateNetworkSettings } = useSettings();
  const { serverUrl, setServerUrl } = useInpaintServer();

  const [serverInput, setServerInput] = useState(serverUrl);
  const [saving, setSaving] = useState(false);
  const [pingStatus, setPingStatus] = useState<"idle" | "checking" | "online" | "offline">("idle");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  const handlePing = async () => {
    const target = serverInput.trim().replace(/\/$/, "");
    if (!target) return;
    setPingStatus("checking");
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${target}/`, { method: "GET", signal: ctrl.signal });
      clearTimeout(timer);
      setPingStatus(res.ok ? "online" : "offline");
    } catch {
      setPingStatus("offline");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await setServerUrl(serverInput);
    setSaving(false);
    Alert.alert("Saved", "Inpaint server URL saved.");
  };

  const handleOpenHFDeploy = async () => {
    const url = "https://huggingface.co/spaces/new?template=yamihot123/mangaverse-inpaint-core";
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Network</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Connection ────────────────────────────────────────────────── */}
        <SettingsSection title="Connection" icon="wifi-outline" defaultExpanded>
          <SettingsItem
            icon="wifi-outline"
            label="Wi-Fi Only"
            description="Only download content over Wi-Fi"
            noChevron
            right={
              <SettingsToggle
                value={networkSettings.wifiOnly}
                onValueChange={(v) => updateNetworkSettings({ wifiOnly: v, mobileData: v ? false : networkSettings.mobileData })}
              />
            }
          />
          <SettingsItem
            icon="cellular-outline"
            label="Mobile Data"
            description="Allow downloads over mobile data"
            noChevron
            last
            right={
              <SettingsToggle
                value={networkSettings.mobileData && !networkSettings.wifiOnly}
                onValueChange={(v) => updateNetworkSettings({ mobileData: v })}
                disabled={networkSettings.wifiOnly}
              />
            }
          />
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* ── Performance ───────────────────────────────────────────────── */}
        <SettingsSection title="Performance" icon="speedometer-outline" defaultExpanded>
          <View style={{ paddingHorizontal: 14, paddingVertical: 14, gap: 16 }}>
            <SettingsSlider
              label="Request Timeout"
              value={networkSettings.timeout}
              min={5}
              max={60}
              step={5}
              onChange={(v) => updateNetworkSettings({ timeout: v })}
              unit="s"
              presets={[
                { label: "15s", value: 15 },
                { label: "30s", value: 30 },
                { label: "60s", value: 60 },
              ]}
            />
            <SettingsSlider
              label="Retry Count"
              value={networkSettings.retryCount}
              min={0}
              max={5}
              onChange={(v) => updateNetworkSettings({ retryCount: v })}
              formatValue={(v) => v === 0 ? "No retry" : `${v}×`}
            />
            <SettingsSlider
              label="Parallel Downloads"
              value={networkSettings.parallelDownloads}
              min={1}
              max={8}
              onChange={(v) => updateNetworkSettings({ parallelDownloads: v })}
              formatValue={(v) => `${v} at once`}
              presets={[
                { label: "1", value: 1 },
                { label: "3", value: 3 },
                { label: "5", value: 5 },
                { label: "8", value: 8 },
              ]}
            />
            <SettingsSlider
              label="Max Connections"
              value={networkSettings.maxConnections}
              min={1}
              max={16}
              onChange={(v) => updateNetworkSettings({ maxConnections: v })}
              formatValue={(v) => `${v} conn`}
            />
          </View>
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* ── Optimization ──────────────────────────────────────────────── */}
        <SettingsSection title="Optimization" icon="flash-outline" defaultExpanded>
          <SettingsItem
            icon="images-outline"
            label="Prefetch Pages"
            description="Load upcoming pages in the background"
            noChevron
            right={
              <SettingsToggle
                value={networkSettings.prefetchPages}
                onValueChange={(v) => updateNetworkSettings({ prefetchPages: v })}
              />
            }
          />
          <SettingsItem
            icon="git-branch-outline"
            label="HTTP/2"
            description="Multiplexed connections for faster loading"
            noChevron
            right={
              <SettingsToggle
                value={networkSettings.http2}
                onValueChange={(v) => updateNetworkSettings({ http2: v })}
              />
            }
          />
          <SettingsItem
            icon="disc-outline"
            label="DNS Cache"
            description="Cache DNS results to reduce latency"
            noChevron
            last
            right={
              <SettingsToggle
                value={networkSettings.dnsCache}
                onValueChange={(v) => updateNetworkSettings({ dnsCache: v })}
              />
            }
          />
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* ── Proxy ─────────────────────────────────────────────────────── */}
        <SettingsSection title="Proxy" icon="navigate-outline" defaultExpanded={false}>
          <SettingsItem
            icon="navigate-outline"
            label="Enable Proxy"
            description="Route all traffic through a proxy server"
            noChevron
            right={
              <SettingsToggle
                value={networkSettings.proxyEnabled}
                onValueChange={(v) => updateNetworkSettings({ proxyEnabled: v })}
              />
            }
          />
          {networkSettings.proxyEnabled && (
            <View style={{ padding: 14, gap: 8 }}>
              <Text style={[styles.inputLabel, { color: colors.foreground }]}>Proxy URL</Text>
              <TextInput
                value={networkSettings.proxyUrl}
                onChangeText={(v) => updateNetworkSettings({ proxyUrl: v })}
                placeholder="http://proxy.example.com:8080"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>
          )}
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* ── Inpaint Server ────────────────────────────────────────────── */}
        <SettingsSection title="Inpaint Server" icon="rocket-outline" defaultExpanded={false} subtitle="AI image cleanup backend">
          <View style={{ padding: 14, gap: 10 }}>
            <Text style={[styles.inputLabel, { color: colors.foreground }]}>Server URL</Text>
            <Text style={[styles.inputDesc, { color: colors.mutedForeground }]}>
              Connect your private OpenCV inpainting backend on Hugging Face Spaces.
            </Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={serverInput}
                onChangeText={(v) => { setServerInput(v); setPingStatus("idle"); }}
                placeholder="https://your-space.hf.space"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Pressable
                onPress={handlePing}
                disabled={pingStatus === "checking" || !serverInput.trim()}
                style={[styles.pingBtn, { backgroundColor: colors.muted, borderColor: colors.border, opacity: serverInput.trim() ? 1 : 0.4 }]}
              >
                {pingStatus === "checking" ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="wifi-outline" size={18} color={colors.primary} />
                )}
              </Pressable>
            </View>

            {pingStatus !== "idle" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[styles.pingDot, { backgroundColor: pingStatus === "online" ? "#22c55e" : pingStatus === "checking" ? colors.primary : "#ef4444" }]} />
                <Text style={{ fontSize: 12, fontWeight: "600" as const, color: pingStatus === "online" ? "#22c55e" : pingStatus === "checking" ? colors.primary : "#ef4444" }}>
                  {pingStatus === "online" ? "Online" : pingStatus === "checking" ? "Checking…" : "Offline / Building"}
                </Text>
              </View>
            )}

            <Pressable
              onPress={handleSave}
              disabled={saving || !serverInput.trim()}
              style={[styles.saveBtn, { backgroundColor: serverInput.trim() ? colors.primary : colors.muted, opacity: saving ? 0.7 : 1 }]}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save Server URL</Text>}
            </Pressable>
          </View>

          <Pressable
            onPress={handleOpenHFDeploy}
            style={[styles.deployBtn, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}30` }]}
          >
            <Ionicons name="rocket-outline" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.deployTitle, { color: colors.primary }]}>Create Your Free Inpaint Server</Text>
              <Text style={[styles.deploySub, { color: colors.mutedForeground }]}>One-click deploy on Hugging Face Spaces</Text>
            </View>
            <Ionicons name="open-outline" size={15} color={colors.primary} />
          </Pressable>
        </SettingsSection>
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
  inputLabel: { fontSize: 14, fontWeight: "500" as const },
  inputDesc: { fontSize: 12, lineHeight: 17 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  pingBtn: { width: 42, height: 42, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pingDot: { width: 8, height: 8, borderRadius: 4 },
  saveBtn: { borderRadius: 8, paddingVertical: 11, alignItems: "center", justifyContent: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" as const },
  deployBtn: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, paddingVertical: 14, paddingHorizontal: 16 },
  deployTitle: { fontSize: 13, fontWeight: "600" as const },
  deploySub: { fontSize: 11, marginTop: 2 },
});
