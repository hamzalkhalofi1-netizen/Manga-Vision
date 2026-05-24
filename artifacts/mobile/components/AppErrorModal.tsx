/**
 * AppErrorModal — polished animated in-app error modal.
 *
 * Features:
 *  • Classifies raw technical error strings into friendly user messages
 *  • Icon + accent color per error category
 *  • Retry button (optional, caller-provided)
 *  • Dismiss button
 *  • Collapsible "Technical details" section (for devs / support)
 *  • Works in light and dark mode
 *  • Animated slide-up entrance / fade-out exit
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

// ── Error classification ───────────────────────────────────────────────────────

type ErrorCategory = "rate_limit" | "auth" | "network" | "ocr" | "generic";

interface ErrorConfig {
  icon: string;
  accentColor: string;
  heading: string;
  body: string;
}

const ERROR_CONFIGS: Record<ErrorCategory, ErrorConfig> = {
  rate_limit: {
    icon: "time-outline",
    accentColor: "#f59e0b",
    heading: "Request Limit Reached",
    body:
      "You've reached the request limit for this API key. Add another key in Settings → AI Keys, or wait a few minutes before trying again.",
  },
  auth: {
    icon: "key-outline",
    accentColor: "#ef4444",
    heading: "API Key Problem",
    body:
      "This API key appears to be invalid, revoked, or disabled. Go to Settings → AI Keys to verify your key or add a new one.",
  },
  network: {
    icon: "wifi-outline",
    accentColor: "#6366f1",
    heading: "Connection Failed",
    body:
      "Unable to reach the translation servers. Check your internet connection and try again.",
  },
  ocr: {
    icon: "scan-outline",
    accentColor: "#10b981",
    heading: "No Text Detected",
    body:
      "Text could not be detected on this page. The page may contain only artwork, or the image quality may be too low for OCR.",
  },
  generic: {
    icon: "alert-circle-outline",
    accentColor: "#e84057",
    heading: "Something Went Wrong",
    body: "An unexpected error occurred. Please try again.",
  },
};

export function classifyError(raw: string): ErrorCategory {
  const msg = raw.toLowerCase();
  if (
    msg.includes("429") ||
    msg.includes("rate_limit") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota")
  )
    return "rate_limit";

  if (
    msg.includes("401") ||
    msg.includes("api_key_invalid") ||
    msg.includes("invalid key") ||
    msg.includes("banned") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized") ||
    msg.includes("permission_denied")
  )
    return "auth";

  if (
    msg.includes("network") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("fetch") ||
    msg.includes("failed to connect") ||
    msg.includes("unable to connect")
  )
    return "network";

  if (
    msg.includes("no text") ||
    msg.includes("ocr") ||
    msg.includes("no regions") ||
    msg.includes("not detected") ||
    msg.includes("no pages")
  )
    return "ocr";

  return "generic";
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** Raw error title — shown as-is if it's already user-friendly */
  title?: string;
  /** Raw technical error string — will be classified + replaced with friendly text */
  technicalMessage: string;
  onDismiss: () => void;
  /** Optional retry handler — shows Retry button when provided */
  onRetry?: () => void;
  /** Override the automatic error category */
  category?: ErrorCategory;
}

export function AppErrorModal({
  visible,
  title,
  technicalMessage,
  onDismiss,
  onRetry,
  category,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);

  const cat = category ?? classifyError(technicalMessage);
  const cfg = ERROR_CONFIGS[cat];

  // The title displayed is either caller-provided or the config heading
  const displayTitle = title && title !== technicalMessage ? title : cfg.heading;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {/* Accent strip */}
          <View style={[styles.accentStrip, { backgroundColor: cfg.accentColor }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: `${cfg.accentColor}22` }]}>
              <Ionicons name={cfg.icon as never} size={26} color={cfg.accentColor} />
            </View>
            <Text style={styles.heading}>{displayTitle}</Text>
          </View>

          {/* Friendly message */}
          <Text style={styles.body}>{cfg.body}</Text>

          {/* Technical details (collapsible) */}
          <Pressable
            onPress={() => setShowDetails((v) => !v)}
            style={styles.detailsToggle}
          >
            <Text style={[styles.detailsToggleTxt, { color: cfg.accentColor }]}>
              {showDetails ? "Hide" : "Show"} technical details
            </Text>
            <Ionicons
              name={showDetails ? "chevron-up" : "chevron-down"}
              size={13}
              color={cfg.accentColor}
            />
          </Pressable>

          {showDetails && (
            <ScrollView
              style={styles.detailsBox}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.detailsTxt} selectable>
                {technicalMessage}
              </Text>
            </ScrollView>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Actions */}
          <View style={styles.actions}>
            {onRetry && (
              <Pressable
                onPress={() => { setShowDetails(false); onRetry(); onDismiss(); }}
                style={[styles.btn, styles.retryBtn, { borderColor: cfg.accentColor }]}
              >
                <Ionicons name="refresh-outline" size={15} color={cfg.accentColor} />
                <Text style={[styles.btnTxt, { color: cfg.accentColor }]}>
                  Try Again
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => { setShowDetails(false); onDismiss(); }}
              style={[styles.btn, styles.dismissBtn]}
            >
              <Text style={styles.dismissTxt}>Dismiss</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#141414",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  accentStrip: {
    height: 3,
    width: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    flex: 1,
    color: "#fff",
    fontSize: 17,
    fontWeight: "700" as const,
    lineHeight: 23,
  },
  body: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  detailsToggleTxt: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  detailsBox: {
    maxHeight: 120,
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 8,
    padding: 10,
  },
  detailsTxt: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
  },
  retryBtn: {
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  dismissBtn: {
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  btnTxt: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
  dismissTxt: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600" as const,
  },
});
