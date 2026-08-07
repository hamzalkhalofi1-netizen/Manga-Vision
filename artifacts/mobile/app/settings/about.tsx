import { Ionicons } from "@expo/vector-icons";
import { Linking } from "react-native";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SettingsSection, SettingsItem } from "@/components/settings";

const APP_VERSION = "1.0.0";
const BUILD_NUMBER = "100";
const EXPO_SDK = "54";

const OPEN_SOURCE = [
  { name: "Expo / React Native", license: "MIT" },
  { name: "React", license: "MIT" },
  { name: "Expo Router", license: "MIT" },
  { name: "TanStack Query", license: "MIT" },
  { name: "Drizzle ORM", license: "Apache-2.0" },
  { name: "Pino Logger", license: "MIT" },
  { name: "Sharp", license: "Apache-2.0" },
  { name: "Google Generative AI", license: "Apache-2.0" },
];

const RELEASE_NOTES = [
  {
    version: "1.0.0",
    date: "2026",
    changes: [
      "Multi-source manga browsing (MangaDex, Comick, and 8+ more)",
      "AI translation with Gemini API key management",
      "CV pipeline for speech bubble detection",
      "Library with reading progress tracking",
      "Offline downloads (native)",
      "Cloudflare bypass via WebView bridge (native)",
    ],
  },
];

function LinkRow({ icon, label, url, desc }: { icon: string; label: string; url?: string; desc?: string }) {
  const handlePress = async () => {
    if (!url) { Alert.alert(label, "Coming soon."); return; }
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
  };
  return (
    <SettingsItem
      icon={icon}
      label={label}
      description={desc}
      onPress={handlePress}
    />
  );
}

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [showLicenses, setShowLicenses] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = 40 + (Platform.OS === "web" ? 34 : insets.bottom);

  const handleVersionTap = () => {
    const next = tapCount + 1;
    setTapCount(next);
    if (next >= 7) {
      Alert.alert("🎉 Developer Mode", "You found the easter egg! Developer options coming soon.", [
        { text: "Cool!", onPress: () => setTapCount(0) },
      ]);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>About</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: 24, paddingBottom: bottomPadding }}
        showsVerticalScrollIndicator={false}
      >
        {/* App identity */}
        <View style={styles.appIdentity}>
          <View style={[styles.appIcon, { backgroundColor: `${colors.primary}20`, borderColor: `${colors.primary}30` }]}>
            <Ionicons name="book" size={40} color={colors.primary} />
          </View>
          <Text style={[styles.appName, { color: colors.foreground }]}>MangaVerse</Text>
          <Text style={[styles.appTagline, { color: colors.mutedForeground }]}>Your universe of stories</Text>

          <Pressable onPress={handleVersionTap} style={[styles.versionBadge, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.versionText, { color: colors.mutedForeground }]}>
              Version {APP_VERSION} · Build {BUILD_NUMBER}
            </Text>
          </Pressable>
        </View>

        {/* App info */}
        <SettingsSection title="App Info" icon="information-circle-outline" defaultExpanded>
          <SettingsItem icon="code-slash-outline" label="Version" description={APP_VERSION} noChevron right={null} />
          <SettingsItem icon="construct-outline" label="Build" description={BUILD_NUMBER} noChevron right={null} />
          <SettingsItem icon="layers-outline" label="Expo SDK" description={EXPO_SDK} noChevron right={null} />
          <SettingsItem
            icon="phone-portrait-outline"
            label="Platform"
            description={Platform.OS === "web" ? "Web" : Platform.OS === "ios" ? `iOS ${Platform.Version}` : `Android API ${Platform.Version}`}
            noChevron
            last
            right={null}
          />
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* Links */}
        <SettingsSection title="Links" icon="link-outline" defaultExpanded>
          <LinkRow icon="shield-checkmark-outline" label="Privacy Policy" desc="How we handle your data" />
          <LinkRow icon="document-text-outline" label="Terms of Service" desc="Usage terms and conditions" />
          <LinkRow
            icon="logo-github"
            label="GitHub"
            desc="Source code and contributions"
            url="https://github.com"
          />
          <SettingsItem
            icon="star-outline"
            label="Rate MangaVerse"
            description="Leave a review on the app store"
            onPress={() => Alert.alert("Rate Us", "Thank you! App store link coming soon.")}
            last
          />
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* Release notes */}
        <SettingsSection title="Release Notes" icon="newspaper-outline" defaultExpanded={false}>
          {RELEASE_NOTES.map((release) => (
            <View key={release.version} style={{ padding: 14, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={[styles.releaseBadge, { backgroundColor: `${colors.primary}20` }]}>
                  <Text style={[styles.releaseVersion, { color: colors.primary }]}>v{release.version}</Text>
                </View>
                <Text style={[styles.releaseDate, { color: colors.mutedForeground }]}>{release.date}</Text>
              </View>
              {release.changes.map((change, i) => (
                <View key={i} style={styles.changeRow}>
                  <View style={[styles.changeDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.changeText, { color: colors.foreground }]}>{change}</Text>
                </View>
              ))}
            </View>
          ))}
        </SettingsSection>

        <View style={{ height: 6 }} />

        {/* Open source */}
        <SettingsSection
          title="Open Source Licenses"
          icon="code-outline"
          defaultExpanded={false}
        >
          {OPEN_SOURCE.map((lib, i) => (
            <SettingsItem
              key={lib.name}
              icon="cube-outline"
              label={lib.name}
              description={`License: ${lib.license}`}
              noChevron
              last={i === OPEN_SOURCE.length - 1}
              right={null}
            />
          ))}
        </SettingsSection>

        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          MangaVerse aggregates content from legal public sources including MangaDex. All content is provided in accordance with the respective platform's Terms of Service.{"\n\n"}
          © 2026 MangaVerse. Built with ❤️ using React Native & Expo.
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
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "600" as const },
  appIdentity: { alignItems: "center", gap: 8, paddingHorizontal: 24, marginBottom: 24 },
  appIcon: {
    width: 80,
    height: 80,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  appName: { fontSize: 26, fontWeight: "700" as const },
  appTagline: { fontSize: 14 },
  versionBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  versionText: { fontSize: 12 },
  releaseBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  releaseVersion: { fontSize: 12, fontWeight: "700" as const },
  releaseDate: { fontSize: 12 },
  changeRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  changeDot: { width: 5, height: 5, borderRadius: 3, marginTop: 6, flexShrink: 0 },
  changeText: { fontSize: 13, lineHeight: 19, flex: 1 },
  disclaimer: { fontSize: 11, lineHeight: 17, textAlign: "center", marginHorizontal: 24, marginTop: 20 },
});
