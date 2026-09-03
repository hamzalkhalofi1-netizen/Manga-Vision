import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { memo } from "react";
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

// ── Menu definition ───────────────────────────────────────────────────────────

interface MenuItem {
  id: string;
  icon: string;
  label: string;
  desc: string;
  route: string;
  badge?: () => string | number | null;
  accent?: boolean;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

// ── Row component ─────────────────────────────────────────────────────────────

const MenuRow = memo(function MenuRow({ item }: { item: MenuItem }) {
  const colors = useColors();
  const badge = item.badge?.();

  return (
    <Pressable
      onPress={() => router.push(item.route as never)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? `${colors.primary}0A` : "transparent",
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.iconBox,
          { backgroundColor: item.accent ? `${colors.primary}20` : `${colors.primary}15` },
        ]}
      >
        <Ionicons
          name={item.icon as never}
          size={18}
          color={colors.primary}
        />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>
          {item.label}
        </Text>
        <Text style={[styles.rowDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.desc}
        </Text>
      </View>
      {badge !== null && badge !== undefined && (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { themeMode, readerSettings } = useSettings();
  const { tokens } = useTokens();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  const MENU: MenuSection[] = [
    {
      title: "Reading",
      items: [
        {
          id: "reader",
          icon: "book-outline",
          label: "Reader",
          desc: "Direction, zoom, brightness, preload",
          route: "/settings/reader",
        },
        {
          id: "fonts",
          icon: "text-outline",
          label: "Fonts & Text",
          desc: "Font family, size, bubble style",
          route: "/settings/fonts",
        },
        {
          id: "image-processing",
          icon: "color-wand-outline",
          label: "Image Processing",
          desc: "Text removal, mask padding, bubble borders",
          route: "/settings/image-processing",
        },
      ],
    },
    {
      title: "Appearance",
      items: [
        {
          id: "theme",
          icon: "contrast-outline",
          label: "Theme",
          desc: themeMode === "auto" ? "Follows system" : themeMode === "dark" ? "Always dark" : "Always light",
          route: "/settings/theme",
        },
      ],
    },
    {
      title: "AI & Translation",
      items: [
        {
          id: "ai-translation",
          icon: "sparkles",
          label: "AI Translation",
          desc: "Gemini keys, model, style, language",
          route: "/settings/ai-translation",
          accent: true,
          badge: () => tokens.length > 0 ? tokens.length : null,
        },
      ],
    },
    {
      title: "Sources",
      items: [
        {
          id: "sources",
          icon: "server-outline",
          label: "Sources",
          desc: "Enable, priority, cookies, stats",
          route: "/settings/sources",
        },
      ],
    },
    {
      title: "Data",
      items: [
        {
          id: "network",
          icon: "wifi-outline",
          label: "Network",
          desc: "Connection, proxy, inpaint server",
          route: "/settings/network",
        },
        {
          id: "storage",
          icon: "archive-outline",
          label: "Storage",
          desc: "Cache, database, cleanup",
          route: "/settings/storage",
        },
        {
          id: "backup",
          icon: "cloud-upload-outline",
          label: "Backup & Restore",
          desc: "Export and import settings",
          route: "/settings/backup",
        },
      ],
    },
    {
      title: "App",
      items: [
        {
          id: "about",
          icon: "information-circle-outline",
          label: "About MangaVerse",
          desc: "Version, licenses, developer",
          route: "/settings/about",
        },
        ...( __DEV__
          ? [{
              id: "debug",
              icon: "bug-outline",
              label: "Settings Debug",
              desc: "Live wiring and persistence audit",
              route: "/settings/debug",
            }]
          : []),
      ],
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPadding, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {MENU.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
              {section.title.toUpperCase()}
            </Text>
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                },
              ]}
            >
              {section.items.map((item, index) => (
                <View
                  key={item.id}
                  style={index < section.items.length - 1 ? {} : { borderBottomWidth: 0 }}
                >
                  <MenuRow item={item} />
                  {index < section.items.length - 1 && (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          MangaVerse aggregates content from legal public sources. All content is provided in accordance with respective platform Terms of Service.
        </Text>
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
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "600" as const },
  section: { paddingHorizontal: 16, marginTop: 22, gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    paddingHorizontal: 4,
  },
  card: { borderWidth: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
    minHeight: 58,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: "500" as const },
  rowDesc: { fontSize: 12, lineHeight: 16 },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" as const },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 64 },
  footer: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginHorizontal: 24,
    marginTop: 24,
  },
});
