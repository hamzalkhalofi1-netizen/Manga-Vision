import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import SourceVerificationModal from "@/components/SourceVerificationModal";
import { useColors } from "@/hooks/useColors";
import { sourceHealth, HealthRecord, SourceHealthStatus } from "@/services/sourceHealth";
import { ALL_SOURCES } from "@/services/sources";
import { MangaSource } from "@/services/sources/types";
import { useSettings } from "@/context/SettingsContext";

const STATUS_COLORS: Record<SourceHealthStatus, string> = {
  healthy:    "#22c55e",
  degraded:   "#f59e0b",
  disabled:   "#ef4444",
  cf_blocked: "#f97316",
};

const STATUS_LABELS: Record<SourceHealthStatus, string> = {
  healthy:    "Online",
  degraded:   "Slow",
  disabled:   "Disabled",
  cf_blocked: "Verify",
};

function HealthDot({ status }: { status: SourceHealthStatus }) {
  return (
    <View
      style={[
        styles.healthDot,
        { backgroundColor: STATUS_COLORS[status] },
      ]}
    />
  );
}

export function SourceSwitcher({ onCfError }: { onCfError?: (sourceId: string) => void }) {
  const colors = useColors();
  const { activeSourceId, setActiveSourceId } = useSettings();
  const [showModal, setShowModal] = useState(false);
  const [healthMap, setHealthMap] = useState<Record<string, HealthRecord>>({});
  const [verifySource, setVerifySource] = useState<MangaSource | null>(null);

  const enabledSources = ALL_SOURCES.filter((s) => s.isEnabled);
  const disabledSources = ALL_SOURCES.filter((s) => !s.isEnabled);

  const loadHealth = useCallback(async () => {
    const entries = await Promise.all(
      ALL_SOURCES.map(async (s) => [s.id, await sourceHealth.getHealth(s.id)] as const),
    );
    setHealthMap(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth, activeSourceId]);

  const handleSelectSource = useCallback(
    (source: MangaSource) => {
      const health = healthMap[source.id];
      if (health) {
        const status = sourceHealth.getStatus(health);
        if (status === "cf_blocked") {
          setVerifySource(source);
          setShowModal(false);
          return;
        }
      }
      setActiveSourceId(source.id);
      setShowModal(false);
    },
    [healthMap, setActiveSourceId],
  );

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {enabledSources.map((source) => {
          const isActive = source.id === activeSourceId;
          const health = healthMap[source.id];
          const status: SourceHealthStatus = health
            ? sourceHealth.getStatus(health)
            : "healthy";
          const isCfBlocked = status === "cf_blocked";

          return (
            <Pressable
              key={source.id}
              onPress={() => handleSelectSource(source)}
              style={[
                styles.pill,
                {
                  backgroundColor: isActive
                    ? colors.primary
                    : isCfBlocked
                    ? "rgba(249,115,22,0.12)"
                    : "rgba(255,255,255,0.06)",
                  borderColor: isActive
                    ? colors.primary
                    : isCfBlocked
                    ? "rgba(249,115,22,0.4)"
                    : "rgba(255,255,255,0.1)",
                  borderRadius: 20,
                },
              ]}
            >
              {isActive && !isCfBlocked && <View style={styles.dot} />}
              {isCfBlocked && (
                <Ionicons name="lock-closed" size={11} color="#f97316" />
              )}
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive
                      ? "#fff"
                      : isCfBlocked
                      ? "#f97316"
                      : colors.mutedForeground,
                  },
                ]}
              >
                {source.name}
              </Text>
              {!isActive && status !== "healthy" && !isCfBlocked && (
                <HealthDot status={status} />
              )}
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => {
            loadHealth();
            setShowModal(true);
          }}
          style={[
            styles.pill,
            {
              backgroundColor: "rgba(255,255,255,0.04)",
              borderColor: "rgba(255,255,255,0.12)",
              borderRadius: 20,
            },
          ]}
        >
          <Ionicons name="add" size={14} color={colors.mutedForeground} />
          <Text style={[styles.label, { color: colors.mutedForeground }]}>More</Text>
        </Pressable>
      </ScrollView>

      {/* Full source list sheet */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowModal(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.card }]}
            onPress={() => {}}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Manga Sources</Text>

            <Text style={[styles.sheetSection, { color: colors.mutedForeground }]}>
              ACTIVE SOURCES
            </Text>
            {enabledSources.map((source) => {
              const isActive = source.id === activeSourceId;
              const health = healthMap[source.id];
              const status: SourceHealthStatus = health
                ? sourceHealth.getStatus(health)
                : "healthy";
              const isCfBlocked = status === "cf_blocked";

              return (
                <Pressable
                  key={source.id}
                  onPress={() => handleSelectSource(source)}
                  style={[
                    styles.sourceRow,
                    { borderColor: colors.border },
                    isActive && { backgroundColor: `${colors.primary}12` },
                  ]}
                >
                  <View
                    style={[
                      styles.sourceIcon,
                      {
                        backgroundColor: isActive
                          ? colors.primary
                          : isCfBlocked
                          ? "rgba(249,115,22,0.15)"
                          : "rgba(255,255,255,0.08)",
                      },
                    ]}
                  >
                    <Ionicons
                      name={isCfBlocked ? "shield-outline" : "library-outline"}
                      size={18}
                      color={
                        isActive ? "#fff" : isCfBlocked ? "#f97316" : colors.mutedForeground
                      }
                    />
                  </View>
                  <View style={styles.sourceInfo}>
                    <Text style={[styles.sourceName, { color: colors.foreground }]}>
                      {source.name}
                      {source.requiresVerification && (
                        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                          {" "}🔒
                        </Text>
                      )}
                    </Text>
                    <Text style={[styles.sourceUrl, { color: colors.mutedForeground }]}>
                      {source.baseUrl}
                    </Text>
                  </View>
                  {isActive ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  ) : (
                    <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLORS[status]}20` }]}>
                      <HealthDot status={status} />
                      <Text style={[styles.statusText, { color: STATUS_COLORS[status] }]}>
                        {STATUS_LABELS[status]}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}

            {disabledSources.length > 0 && (
              <>
                <Text
                  style={[styles.sheetSection, { color: colors.mutedForeground, marginTop: 16 }]}
                >
                  COMING SOON
                </Text>
                {disabledSources.map((source) => (
                  <View
                    key={source.id}
                    style={[styles.sourceRow, { borderColor: colors.border, opacity: 0.45 }]}
                  >
                    <View
                      style={[
                        styles.sourceIcon,
                        { backgroundColor: "rgba(255,255,255,0.05)" },
                      ]}
                    >
                      <Ionicons
                        name="lock-closed-outline"
                        size={18}
                        color={colors.mutedForeground}
                      />
                    </View>
                    <View style={styles.sourceInfo}>
                      <Text style={[styles.sourceName, { color: colors.foreground }]}>
                        {source.name}
                      </Text>
                      <Text style={[styles.sourceUrl, { color: colors.mutedForeground }]}>
                        {source.baseUrl}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.soonBadge,
                        {
                          backgroundColor: `${colors.primary}20`,
                          borderColor: `${colors.primary}30`,
                        },
                      ]}
                    >
                      <Text style={[styles.soonText, { color: colors.primary }]}>Soon</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            <Pressable
              onPress={() => setShowModal(false)}
              style={[styles.closeBtn, { backgroundColor: colors.primary, borderRadius: 12 }]}
            >
              <Text style={styles.closeBtnText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Verification modal for CF-protected sources */}
      {verifySource && (
        <SourceVerificationModal
          visible={verifySource !== null}
          sourceId={verifySource.id}
          sourceName={verifySource.name}
          sourceUrl={verifySource.baseUrl}
          onVerified={() => {
            setActiveSourceId(verifySource.id);
            setVerifySource(null);
          }}
          onDismiss={() => setVerifySource(null)}
          onChangeSource={() => setVerifySource(null)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  healthDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 13,
    fontWeight: "500" as const,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    gap: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    marginBottom: 8,
  },
  sheetSection: {
    fontSize: 11,
    fontWeight: "600" as const,
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 4,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceInfo: {
    flex: 1,
    gap: 2,
  },
  sourceName: {
    fontSize: 15,
    fontWeight: "600" as const,
  },
  sourceUrl: {
    fontSize: 11,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  soonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  soonText: {
    fontSize: 11,
    fontWeight: "600" as const,
  },
  closeBtn: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600" as const,
  },
});
