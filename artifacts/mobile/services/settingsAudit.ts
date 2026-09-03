export type SettingsAuditStatus = "connected" | "partial" | "unused";

export interface SettingsAuditEntry {
  id: string;
  label: string;
  group: string;
  groupKey: string;
  valueKey: string;
  status: SettingsAuditStatus;
  consumer: string;
  currentValue?: unknown;
}

export const SETTINGS_AUDIT: SettingsAuditEntry[] = [
  ...["readingMode", "targetLanguage", "dataSaver", "showPageNumber", "readingDirection", "pageTransition", "pageAnimation", "keepScreenAwake", "hideSystemBars", "rememberLastPage", "brightness", "doubleTapZoom", "pinchZoom", "fitMode", "showProgressBar", "preloadPages"].map((valueKey) => ({ id: `reader.${valueKey}`, label: valueKey, group: "Reader", groupKey: "reader", valueKey, status: "connected" as const, consumer: "Reader screen / MangaPage" })),
  ...["fontFamily", "fontSize", "fontWeight", "lineSpacing", "letterSpacing", "textAlign", "outlineThickness", "outlineColor", "textColor", "bgColor", "bgOpacity", "bubbleBorderRadius", "bubblePadding", "shadow", "textQuality"].map((valueKey) => ({ id: `fonts.${valueKey}`, label: valueKey, group: "Fonts", groupKey: "fonts", valueKey, status: "connected" as const, consumer: "CVPipelineRenderer + SkiaOverlayCanvas" })),
  ...["wifiOnly", "mobileData", "timeout", "retryCount", "parallelDownloads", "maxConnections", "prefetchPages", "http2", "dnsCache", "proxyEnabled", "proxyUrl"].map((valueKey) => ({ id: `network.${valueKey}`, label: valueKey, group: "Network", groupKey: "network", valueKey, status: ["http2", "dnsCache", "proxyEnabled", "proxyUrl"].includes(valueKey) ? "partial" as const : "connected" as const, consumer: "ReaderPreloader / translationQueue" })),
  ...["style", "customStyle", "translateSFX", "translateNarration", "translateCredits", "keepOriginal", "autoRetry", "maxRetries", "timeoutSeconds"].map((valueKey) => ({ id: `translation.${valueKey}`, label: valueKey, group: "Translation", groupKey: "translation", valueKey, status: "connected" as const, consumer: "Gemini API + translation cache" })),
  ...["removalMode", "maskPadding", "preserveBubbleBorders"].map((valueKey) => ({ id: `image.${valueKey}`, label: valueKey, group: "Image processing", groupKey: "imageProcessing", valueKey, status: "connected" as const, consumer: "CV pipeline request" })),
  { id: "theme.mode", label: "themeMode", group: "Theme", groupKey: "theme", valueKey: "themeMode", status: "connected", consumer: "useColors + root/system background" },
  { id: "ai.model", label: "geminiModel", group: "AI", groupKey: "ai", valueKey: "geminiModel", status: "connected", consumer: "Gemini translation request" },
];

export function getSettingsAuditSummary() {
  return SETTINGS_AUDIT.reduce(
    (summary, entry) => {
      summary[entry.status] += 1;
      return summary;
    },
    { connected: 0, partial: 0, unused: 0 },
  );
}

export function getSettingsAuditEntries(values: Record<string, unknown>) {
  return SETTINGS_AUDIT.map((entry) => ({
    ...entry,
    currentValue: values[entry.valueKey],
  }));
}