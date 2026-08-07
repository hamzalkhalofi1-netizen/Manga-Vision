import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useSettings, ThemeMode } from "@/context/SettingsContext";

const THEME_OPTIONS: Array<{ value: ThemeMode; icon: string; label: string; desc: string }> = [
  { value: "auto",  icon: "phone-portrait-outline", label: "Auto",       desc: "Follows your system setting" },
  { value: "dark",  icon: "moon-outline",           label: "Dark Mode",  desc: "Always use dark theme" },
  { value: "light", icon: "sunny-outline",          label: "Light Mode", desc: "Always use light theme" },
];

export default function ThemeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { themeMode, setThemeMode } = useSettings();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Theme</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={{ padding: 16, gap: 10 }}>
        {THEME_OPTIONS.map((opt) => {
          const active = themeMode === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setThemeMode(opt.value)}
              style={[
                styles.themeCard,
                {
                  backgroundColor: active ? `${colors.primary}15` : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <View style={[styles.themeIconWrap, { backgroundColor: active ? `${colors.primary}20` : `${colors.primary}10` }]}>
                <Ionicons name={opt.icon as never} size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.themeLabel, { color: colors.foreground }]}>{opt.label}</Text>
                <Text style={[styles.themeDesc, { color: colors.mutedForeground }]}>{opt.desc}</Text>
              </View>
              {active && (
                <View style={[styles.checkCircle, { backgroundColor: colors.primary }]}>
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
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
  themeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderWidth: 1,
  },
  themeIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  themeLabel: { fontSize: 16, fontWeight: "500" as const },
  themeDesc: { fontSize: 12, marginTop: 2 },
  checkCircle: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
