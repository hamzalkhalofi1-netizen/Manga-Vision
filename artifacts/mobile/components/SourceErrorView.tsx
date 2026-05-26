import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import type { SourceErrorType } from "@/services/sources";

interface Props {
  errorType?: SourceErrorType;
  message?: string;
  sourceName?: string;
  onVerify?: () => void;
  onRetry?: () => void;
  onChangeSource?: () => void;
  onBack?: () => void;
  compact?: boolean;
}

function humanTitle(errorType?: SourceErrorType): string {
  switch (errorType) {
    case "cloudflare": return "Verification Required";
    case "auth": return "Verification Required";
    case "rate_limit": return "Rate Limited";
    case "not_found": return "Not Found";
    case "network": return "Connection Error";
    case "upstream": return "Source Unavailable";
    default: return "Failed to Load";
  }
}

function humanMessage(errorType?: SourceErrorType, sourceName?: string): string {
  const src = sourceName ?? "This source";
  switch (errorType) {
    case "cloudflare":
      return `${src} uses Cloudflare protection. You need to complete a one-time browser verification before content can load.`;
    case "auth":
      return `${src} requires browser verification before chapters can load. Tap "Verify Source" to open the site and complete the check.`;
    case "rate_limit":
      return `${src} is temporarily rate-limiting requests. Please wait a moment, then tap Retry.`;
    case "not_found":
      return "This content was not found. It may have been removed or the title ID changed.";
    case "network":
      return "A network error occurred. Check your connection and tap Retry.";
    case "upstream":
      return `${src} server is currently unavailable. Try again later or switch to another source.`;
    default:
      return "Failed to load content. Please try again.";
  }
}

export function SourceErrorView({
  errorType,
  message,
  sourceName,
  onVerify,
  onRetry,
  onChangeSource,
  onBack,
  compact = false,
}: Props) {
  const colors = useColors();
  const needsVerify = errorType === "cloudflare" || errorType === "auth";
  const displayMessage = message ?? humanMessage(errorType, sourceName);
  const title = humanTitle(errorType);

  if (compact) {
    return (
      <View style={[st.compactContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons
          name={needsVerify ? "shield-checkmark-outline" : "alert-circle-outline"}
          size={22}
          color={needsVerify ? colors.primary : colors.mutedForeground}
        />
        <View style={st.compactText}>
          <Text style={[st.compactTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[st.compactMsg, { color: colors.mutedForeground }]} numberOfLines={3}>
            {displayMessage}
          </Text>
        </View>
        <View style={st.compactActions}>
          {needsVerify && onVerify && (
            <Pressable
              onPress={onVerify}
              style={[st.compactBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={st.compactBtnText}>Verify</Text>
            </Pressable>
          )}
          {onRetry && (
            <Pressable
              onPress={onRetry}
              style={[st.compactBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
            >
              <Text style={[st.compactBtnText, { color: colors.foreground }]}>Retry</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons
          name={needsVerify ? "shield-checkmark-outline" : "alert-circle-outline"}
          size={52}
          color={needsVerify ? colors.primary : colors.mutedForeground}
        />
        <Text style={[st.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[st.message, { color: colors.mutedForeground }]}>{displayMessage}</Text>

        {needsVerify && onVerify && (
          <Pressable
            onPress={onVerify}
            style={[st.btn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="globe-outline" size={16} color="#fff" />
            <Text style={st.btnPrimaryText}>Verify Source</Text>
          </Pressable>
        )}

        {onRetry && (
          <Pressable
            onPress={onRetry}
            style={[st.btn, st.outlineBtn, { borderColor: colors.border }]}
          >
            <Ionicons name="refresh" size={16} color={colors.foreground} />
            <Text style={[st.btnOutlineText, { color: colors.foreground }]}>Retry</Text>
          </Pressable>
        )}

        <View style={st.row}>
          {onChangeSource && (
            <Pressable
              onPress={onChangeSource}
              style={[st.smallBtn, { borderColor: colors.border }]}
            >
              <Text style={[st.smallBtnText, { color: colors.mutedForeground }]}>Change Source</Text>
            </Pressable>
          )}
          {onBack && (
            <Pressable
              onPress={onBack}
              style={[st.smallBtn, { borderColor: colors.border }]}
            >
              <Text style={[st.smallBtnText, { color: colors.mutedForeground }]}>Go Back</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    borderRadius: 20,
    padding: 28,
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    fontSize: 19,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
  btn: {
    width: "100%",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
  },
  outlineBtn: {
    borderWidth: 1.5,
    backgroundColor: "transparent",
  },
  btnPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  btnOutlineText: {
    fontWeight: "600",
    fontSize: 15,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  smallBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  smallBtnText: {
    fontSize: 13,
    fontWeight: "500",
  },
  compactContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  compactText: {
    flex: 1,
    gap: 4,
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  compactMsg: {
    fontSize: 12,
    lineHeight: 18,
  },
  compactActions: {
    gap: 6,
  },
  compactBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  },
  compactBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
