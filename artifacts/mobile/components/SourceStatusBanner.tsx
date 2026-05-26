/**
 * SourceStatusBanner
 *
 * Appears automatically when a source's WebView bridge detects a CF challenge.
 * The user taps "Verify" to reveal the persistent WebView inline.
 * After the challenge is solved the banner auto-dismisses.
 *
 * This replaces the old SourceVerificationModal popup pattern.
 * Verification now happens once per session; the WebView keeps its cookies
 * across every subsequent request.
 */

import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BridgeContext, useBridgeStatus } from "@/components/GlobalWebViewBridge";
import { useColors } from "@/hooks/useColors";

interface Props {
  sourceId: string;
  sourceName: string;
}

export default function SourceStatusBanner({ sourceId, sourceName }: Props) {
  const colors = useColors();
  const status = useBridgeStatus(sourceId);
  const { showVerification, hideVerification } = useContext(BridgeContext);
  const slideY = useRef(new Animated.Value(-80)).current;
  const [mounted, setMounted] = useState(false);

  const isChallenge = status === "cf_challenge";
  const isVerifying = status === "executing" || status === "initializing";

  useEffect(() => {
    if (isChallenge) {
      setMounted(true);
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    } else {
      Animated.timing(slideY, {
        toValue: -80,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setMounted(false));
      hideVerification();
    }
  }, [isChallenge, slideY, hideVerification]);

  if (!mounted && !isChallenge) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: colors.isDark ? "#1e293b" : "#fff", transform: [{ translateY: slideY }] },
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="shield-outline" size={20} color="#f59e0b" />
      </View>
      <View style={styles.textWrap}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {sourceName} — Browser Verification Required
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Tap Verify to solve the Cloudflare challenge once. Future loads will be instant.
        </Text>
      </View>
      <Pressable
        onPress={() => showVerification(sourceId)}
        style={[styles.btn, { backgroundColor: colors.primary }]}
      >
        <Text style={styles.btnText}>Verify</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 6,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(245,158,11,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 1,
  },
  sub: {
    fontSize: 11,
    lineHeight: 14,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  btnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
