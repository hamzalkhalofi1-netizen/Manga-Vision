import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SettingsSectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  badge?: string | number;
  /** Shown below the title in the header */
  subtitle?: string;
}

export function SettingsSection({
  title,
  icon,
  children,
  defaultExpanded = true,
  badge,
  subtitle,
}: SettingsSectionProps) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rotateAnim = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = useCallback(() => {
    const nextExpanded = !expanded;
    LayoutAnimation.configureNext({
      duration: 220,
      create: { type: "easeInEaseOut", property: "opacity" },
      update: { type: "spring", springDamping: 0.8 },
      delete: { type: "easeInEaseOut", property: "opacity" },
    });
    setExpanded(nextExpanded);
    Animated.timing(rotateAnim, {
      toValue: nextExpanded ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [expanded, rotateAnim]);

  const chevronRotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });

  return (
    <View style={styles.section}>
      {/* Section header — tappable to collapse/expand */}
      <Pressable
        onPress={toggle}
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}1A` }]}>
          <Ionicons name={icon as never} size={17} color={colors.primary} />
        </View>

        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {badge !== undefined && (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={styles.badgeText}>{String(badge)}</Text>
          </View>
        )}

        <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
          <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
        </Animated.View>
      </Pressable>

      {/* Collapsible card body */}
      {expanded ? (
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
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    marginBottom: 6,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerText: {
    flex: 1,
    gap: 1,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700" as const,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
});
