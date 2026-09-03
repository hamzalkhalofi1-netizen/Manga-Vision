import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { GeminiModel } from "@/services/geminiKeyTest";

// ── Base types (unchanged) ──────────────────────────────────────────────────

export type ReadingMode = "vertical" | "horizontal";
export type TargetLanguage = "en" | "es" | "pt" | "fr" | "de" | "ja" | "ko" | "zh" | "ar";
export type ThemeMode = "auto" | "light" | "dark";
export type { GeminiModel };

// ── Extended reader types ───────────────────────────────────────────────────

export type ReadingDirection = "ltr" | "rtl";
export type PageTransition = "scroll" | "swipe";
export type FitMode = "width" | "height" | "screen";

export interface ReaderSettings {
  // existing
  readingMode: ReadingMode;
  targetLanguage: TargetLanguage;
  dataSaver: boolean;
  showPageNumber: boolean;
  // new
  readingDirection: ReadingDirection;
  pageTransition: PageTransition;
  pageAnimation: boolean;
  keepScreenAwake: boolean;
  hideSystemBars: boolean;
  rememberLastPage: boolean;
  brightness: number; // -1 = auto, 0.0–1.0 for manual
  doubleTapZoom: boolean;
  pinchZoom: boolean;
  fitMode: FitMode;
  showProgressBar: boolean;
  preloadPages: number; // 1–5
}

// ── Font types ──────────────────────────────────────────────────────────────

export type FontFamily = "system" | "inter" | "monospace";
export type FontWeight = "400" | "500" | "600" | "700";
export type TextQuality = "low" | "medium" | "high";

export interface FontSettings {
  fontFamily: FontFamily;
  fontSize: number; // 12–24
  fontWeight: FontWeight;
  lineSpacing: number; // 1.0–2.5
  letterSpacing: number; // -1 to 3
  textAlign: "left" | "center" | "right";
  outlineThickness: number; // 0–4
  outlineColor: string;
  textColor: string;
  bgColor: string;
  bgOpacity: number; // 0–100
  bubbleBorderRadius: number; // 0–24
  bubblePadding: number; // 4–20
  shadow: boolean;
  textQuality: TextQuality;
}

// ── Network types ───────────────────────────────────────────────────────────

export interface NetworkSettings {
  wifiOnly: boolean;
  mobileData: boolean;
  timeout: number; // 5–60 s
  retryCount: number; // 0–5
  parallelDownloads: number; // 1–8
  maxConnections: number; // 1–16
  prefetchPages: boolean;
  http2: boolean;
  dnsCache: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
}

// ── Translation types ───────────────────────────────────────────────────────

export type TranslationStyle = "literal" | "natural" | "professional" | "anime" | "custom";

export interface TranslationSettings {
  style: TranslationStyle;
  customStyle: string;
  translateSFX: boolean;
  translateNarration: boolean;
  translateCredits: boolean;
  keepOriginal: boolean;
  autoRetry: boolean;
  maxRetries: number; // 1–5
  timeoutSeconds: number; // 10–120
}

export interface ImageProcessingSettings {
  removalMode: "inpaint" | "overlay";
  maskPadding: number; // 0–24 px
  preserveBubbleBorders: boolean;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_READER: ReaderSettings = {
  readingMode: "vertical",
  targetLanguage: "en",
  dataSaver: false,
  showPageNumber: true,
  readingDirection: "ltr",
  pageTransition: "scroll",
  pageAnimation: true,
  keepScreenAwake: true,
  hideSystemBars: false,
  rememberLastPage: true,
  brightness: -1,
  doubleTapZoom: true,
  pinchZoom: true,
  fitMode: "width",
  showProgressBar: true,
  preloadPages: 2,
};

export const DEFAULT_FONT_SETTINGS: FontSettings = {
  fontFamily: "system",
  fontSize: 16,
  fontWeight: "400",
  lineSpacing: 1.4,
  letterSpacing: 0,
  textAlign: "center",
  outlineThickness: 1,
  outlineColor: "#000000",
  textColor: "#FFFFFF",
  bgColor: "#000000",
  bgOpacity: 70,
  bubbleBorderRadius: 12,
  bubblePadding: 10,
  shadow: true,
  textQuality: "high",
};

const DEFAULT_NETWORK: NetworkSettings = {
  wifiOnly: false,
  mobileData: true,
  timeout: 30,
  retryCount: 3,
  parallelDownloads: 3,
  maxConnections: 8,
  prefetchPages: true,
  http2: true,
  dnsCache: true,
  proxyEnabled: false,
  proxyUrl: "",
};

const DEFAULT_TRANSLATION: TranslationSettings = {
  style: "natural",
  customStyle: "",
  translateSFX: true,
  translateNarration: true,
  translateCredits: false,
  keepOriginal: false,
  autoRetry: true,
  maxRetries: 3,
  timeoutSeconds: 30,
};

export const DEFAULT_IMAGE_PROCESSING: ImageProcessingSettings = {
  removalMode: "inpaint",
  maskPadding: 4,
  preserveBubbleBorders: true,
};

// ── Storage keys ────────────────────────────────────────────────────────────

const SETTINGS_KEY          = "mangaverse_settings";
const SOURCE_KEY            = "mangaverse_source";
const TRANSLATION_COUNT_KEY = "mangaverse_translations";
const THEME_KEY             = "mangaverse_theme";
const GEMINI_MODEL_KEY      = "mangaverse_gemini_model";
const FONT_KEY              = "mangaverse_font_settings";
const NETWORK_KEY           = "mangaverse_network_settings";
const TRANSLATION_CFG_KEY   = "mangaverse_translation_settings";
const IMAGE_PROCESSING_KEY  = "mangaverse_image_processing_settings";

const VALID_GEMINI_MODELS: GeminiModel[] = [
  "gemini-flash-lite-latest",
];

const TARGET_LANGUAGES: TargetLanguage[] = ["en", "es", "pt", "fr", "de", "ja", "ko", "zh", "ar"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const pick = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === "string" && values.includes(value as T) ? value as T : fallback;

function normalizeReader(raw: unknown): ReaderSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    ...DEFAULT_READER,
    readingMode: pick(value.readingMode, ["vertical", "horizontal"] as const, DEFAULT_READER.readingMode),
    targetLanguage: pick(value.targetLanguage, TARGET_LANGUAGES, DEFAULT_READER.targetLanguage),
    dataSaver: typeof value.dataSaver === "boolean" ? value.dataSaver : DEFAULT_READER.dataSaver,
    showPageNumber: typeof value.showPageNumber === "boolean" ? value.showPageNumber : DEFAULT_READER.showPageNumber,
    readingDirection: pick(value.readingDirection, ["ltr", "rtl"] as const, DEFAULT_READER.readingDirection),
    pageTransition: pick(value.pageTransition, ["scroll", "swipe"] as const, DEFAULT_READER.pageTransition),
    pageAnimation: typeof value.pageAnimation === "boolean" ? value.pageAnimation : DEFAULT_READER.pageAnimation,
    keepScreenAwake: typeof value.keepScreenAwake === "boolean" ? value.keepScreenAwake : DEFAULT_READER.keepScreenAwake,
    hideSystemBars: typeof value.hideSystemBars === "boolean" ? value.hideSystemBars : DEFAULT_READER.hideSystemBars,
    rememberLastPage: typeof value.rememberLastPage === "boolean" ? value.rememberLastPage : DEFAULT_READER.rememberLastPage,
    brightness: clamp(value.brightness, -1, 1, DEFAULT_READER.brightness),
    doubleTapZoom: typeof value.doubleTapZoom === "boolean" ? value.doubleTapZoom : DEFAULT_READER.doubleTapZoom,
    pinchZoom: typeof value.pinchZoom === "boolean" ? value.pinchZoom : DEFAULT_READER.pinchZoom,
    fitMode: pick(value.fitMode, ["width", "height", "screen"] as const, DEFAULT_READER.fitMode),
    showProgressBar: typeof value.showProgressBar === "boolean" ? value.showProgressBar : DEFAULT_READER.showProgressBar,
    preloadPages: Math.round(clamp(value.preloadPages, 1, 5, DEFAULT_READER.preloadPages)),
  };
}

function normalizeFont(raw: unknown): FontSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    ...DEFAULT_FONT_SETTINGS,
    fontFamily: pick(value.fontFamily, ["system", "inter", "monospace"] as const, DEFAULT_FONT_SETTINGS.fontFamily),
    fontSize: Math.round(clamp(value.fontSize, 12, 24, DEFAULT_FONT_SETTINGS.fontSize)),
    fontWeight: pick(value.fontWeight, ["400", "500", "600", "700"] as const, DEFAULT_FONT_SETTINGS.fontWeight),
    lineSpacing: clamp(value.lineSpacing, 1, 2.5, DEFAULT_FONT_SETTINGS.lineSpacing),
    letterSpacing: clamp(value.letterSpacing, -1, 3, DEFAULT_FONT_SETTINGS.letterSpacing),
    textAlign: pick(value.textAlign, ["left", "center", "right"] as const, DEFAULT_FONT_SETTINGS.textAlign),
    outlineThickness: clamp(value.outlineThickness, 0, 4, DEFAULT_FONT_SETTINGS.outlineThickness),
    outlineColor: typeof value.outlineColor === "string" ? value.outlineColor : DEFAULT_FONT_SETTINGS.outlineColor,
    textColor: typeof value.textColor === "string" ? value.textColor : DEFAULT_FONT_SETTINGS.textColor,
    bgColor: typeof value.bgColor === "string" ? value.bgColor : DEFAULT_FONT_SETTINGS.bgColor,
    bgOpacity: clamp(value.bgOpacity, 0, 100, DEFAULT_FONT_SETTINGS.bgOpacity),
    bubbleBorderRadius: clamp(value.bubbleBorderRadius, 0, 24, DEFAULT_FONT_SETTINGS.bubbleBorderRadius),
    bubblePadding: clamp(value.bubblePadding, 4, 20, DEFAULT_FONT_SETTINGS.bubblePadding),
    shadow: typeof value.shadow === "boolean" ? value.shadow : DEFAULT_FONT_SETTINGS.shadow,
    textQuality: pick(value.textQuality, ["low", "medium", "high"] as const, DEFAULT_FONT_SETTINGS.textQuality),
  };
}

function normalizeNetwork(raw: unknown): NetworkSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    ...DEFAULT_NETWORK,
    wifiOnly: typeof value.wifiOnly === "boolean" ? value.wifiOnly : DEFAULT_NETWORK.wifiOnly,
    mobileData: typeof value.mobileData === "boolean" ? value.mobileData : DEFAULT_NETWORK.mobileData,
    timeout: Math.round(clamp(value.timeout, 5, 60, DEFAULT_NETWORK.timeout)),
    retryCount: Math.round(clamp(value.retryCount, 0, 5, DEFAULT_NETWORK.retryCount)),
    parallelDownloads: Math.round(clamp(value.parallelDownloads, 1, 8, DEFAULT_NETWORK.parallelDownloads)),
    maxConnections: Math.round(clamp(value.maxConnections, 1, 16, DEFAULT_NETWORK.maxConnections)),
    prefetchPages: typeof value.prefetchPages === "boolean" ? value.prefetchPages : DEFAULT_NETWORK.prefetchPages,
    http2: typeof value.http2 === "boolean" ? value.http2 : DEFAULT_NETWORK.http2,
    dnsCache: typeof value.dnsCache === "boolean" ? value.dnsCache : DEFAULT_NETWORK.dnsCache,
    proxyEnabled: typeof value.proxyEnabled === "boolean" ? value.proxyEnabled : DEFAULT_NETWORK.proxyEnabled,
    proxyUrl: typeof value.proxyUrl === "string" ? value.proxyUrl.trim() : DEFAULT_NETWORK.proxyUrl,
  };
}

function normalizeTranslation(raw: unknown): TranslationSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    ...DEFAULT_TRANSLATION,
    style: pick(value.style, ["literal", "natural", "professional", "anime", "custom"] as const, DEFAULT_TRANSLATION.style),
    customStyle: typeof value.customStyle === "string" ? value.customStyle : DEFAULT_TRANSLATION.customStyle,
    translateSFX: typeof value.translateSFX === "boolean" ? value.translateSFX : DEFAULT_TRANSLATION.translateSFX,
    translateNarration: typeof value.translateNarration === "boolean" ? value.translateNarration : DEFAULT_TRANSLATION.translateNarration,
    translateCredits: typeof value.translateCredits === "boolean" ? value.translateCredits : DEFAULT_TRANSLATION.translateCredits,
    keepOriginal: typeof value.keepOriginal === "boolean" ? value.keepOriginal : DEFAULT_TRANSLATION.keepOriginal,
    autoRetry: typeof value.autoRetry === "boolean" ? value.autoRetry : DEFAULT_TRANSLATION.autoRetry,
    maxRetries: Math.round(clamp(value.maxRetries, 1, 5, DEFAULT_TRANSLATION.maxRetries)),
    timeoutSeconds: Math.round(clamp(value.timeoutSeconds, 10, 120, DEFAULT_TRANSLATION.timeoutSeconds)),
  };
}

function normalizeImageProcessing(raw: unknown): ImageProcessingSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    removalMode: pick(value.removalMode, ["inpaint", "overlay"] as const, DEFAULT_IMAGE_PROCESSING.removalMode),
    maskPadding: clamp(value.maskPadding, 0, 24, DEFAULT_IMAGE_PROCESSING.maskPadding),
    preserveBubbleBorders: typeof value.preserveBubbleBorders === "boolean"
      ? value.preserveBubbleBorders
      : DEFAULT_IMAGE_PROCESSING.preserveBubbleBorders,
  };
}

async function persist(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[settings] Could not persist ${key}`, error);
  }
}

// ── Context type ─────────────────────────────────────────────────────────────

interface SettingsContextType {
  settingsReady: boolean;
  settingsLastUpdated: Record<string, number>;
  // Reader
  readerSettings: ReaderSettings;
  updateReaderSettings: (settings: Partial<ReaderSettings>) => void;
  // Source
  activeSourceId: string;
  setActiveSourceId: (id: string) => void;
  // Counts
  translationCount: number;
  incrementTranslationCount: () => void;
  // Theme
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  // Model
  geminiModel: GeminiModel;
  setGeminiModel: (model: GeminiModel) => void;
  // Font
  fontSettings: FontSettings;
  updateFontSettings: (settings: Partial<FontSettings>) => void;
  resetFontSettings: () => void;
  // Network
  networkSettings: NetworkSettings;
  updateNetworkSettings: (settings: Partial<NetworkSettings>) => void;
  // Translation config
  translationSettings: TranslationSettings;
  updateTranslationSettings: (settings: Partial<TranslationSettings>) => void;
  imageProcessingSettings: ImageProcessingSettings;
  updateImageProcessingSettings: (settings: Partial<ImageProcessingSettings>) => void;
  restoreSettings: (settings: Partial<{
    readerSettings: ReaderSettings;
    fontSettings: FontSettings;
    networkSettings: NetworkSettings;
    translationSettings: TranslationSettings;
    imageProcessingSettings: ImageProcessingSettings;
    themeMode: ThemeMode;
    geminiModel: GeminiModel;
  }>) => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsLastUpdated, setSettingsLastUpdated] = useState<Record<string, number>>({});
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(DEFAULT_READER);
  const [activeSourceId, setActiveSourceIdState] = useState("mangadex");
  const [translationCount, setTranslationCount] = useState(0);
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");
  const [geminiModel, setGeminiModelState] = useState<GeminiModel>("gemini-flash-lite-latest");
  const [fontSettings, setFontSettings] = useState<FontSettings>(DEFAULT_FONT_SETTINGS);
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings>(DEFAULT_NETWORK);
  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>(DEFAULT_TRANSLATION);
  const [imageProcessingSettings, setImageProcessingSettings] = useState<ImageProcessingSettings>(DEFAULT_IMAGE_PROCESSING);

  useEffect(() => {
    async function load() {
      try {
        const [settingsRaw, sourceRaw, countRaw, themeRaw, modelRaw, fontRaw, networkRaw, translRaw, imageRaw] =
          await Promise.all([
            AsyncStorage.getItem(SETTINGS_KEY),
            AsyncStorage.getItem(SOURCE_KEY),
            AsyncStorage.getItem(TRANSLATION_COUNT_KEY),
            AsyncStorage.getItem(THEME_KEY),
            AsyncStorage.getItem(GEMINI_MODEL_KEY),
            AsyncStorage.getItem(FONT_KEY),
            AsyncStorage.getItem(NETWORK_KEY),
            AsyncStorage.getItem(TRANSLATION_CFG_KEY),
            AsyncStorage.getItem(IMAGE_PROCESSING_KEY),
          ]);
        if (settingsRaw) setReaderSettings(normalizeReader(JSON.parse(settingsRaw)));
        if (sourceRaw) setActiveSourceIdState(sourceRaw);
        if (countRaw) setTranslationCount(parseInt(countRaw, 10) || 0);
        if (themeRaw && ["auto", "light", "dark"].includes(themeRaw)) {
          setThemeModeState(themeRaw as ThemeMode);
        }
        if (modelRaw && VALID_GEMINI_MODELS.includes(modelRaw as GeminiModel)) {
          setGeminiModelState(modelRaw as GeminiModel);
        }
        if (fontRaw) setFontSettings(normalizeFont(JSON.parse(fontRaw)));
        if (networkRaw) setNetworkSettings(normalizeNetwork(JSON.parse(networkRaw)));
        if (translRaw) setTranslationSettings(normalizeTranslation(JSON.parse(translRaw)));
        if (imageRaw) setImageProcessingSettings(normalizeImageProcessing(JSON.parse(imageRaw)));
      } catch (error) {
        console.warn("[settings] Could not load persisted settings; using safe defaults", error);
      } finally {
        setSettingsReady(true);
      }
    }
    load();
  }, []);

  const touch = useCallback((group: string) => {
    setSettingsLastUpdated((previous) => ({ ...previous, [group]: Date.now() }));
  }, []);

  const updateReaderSettings = useCallback((settings: Partial<ReaderSettings>) => {
    setReaderSettings((prev) => {
      const next = normalizeReader({ ...prev, ...settings });
      void persist(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
    touch("reader");
  }, [touch]);

  const setActiveSourceId = useCallback((id: string) => {
    setActiveSourceIdState(id);
    void persist(SOURCE_KEY, id);
    touch("source");
  }, [touch]);

  const incrementTranslationCount = useCallback(() => {
    setTranslationCount((prev) => {
      const next = prev + 1;
      void persist(TRANSLATION_COUNT_KEY, String(next));
      return next;
    });
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    void persist(THEME_KEY, mode);
    touch("theme");
  }, [touch]);

  const setGeminiModel = useCallback((model: GeminiModel) => {
    setGeminiModelState(model);
    void persist(GEMINI_MODEL_KEY, model);
    touch("ai");
  }, [touch]);

  const updateFontSettings = useCallback((settings: Partial<FontSettings>) => {
    setFontSettings((prev) => {
      const next = normalizeFont({ ...prev, ...settings });
      void persist(FONT_KEY, JSON.stringify(next));
      return next;
    });
    touch("fonts");
  }, [touch]);

  const resetFontSettings = useCallback(() => {
    setFontSettings(DEFAULT_FONT_SETTINGS);
    void persist(FONT_KEY, JSON.stringify(DEFAULT_FONT_SETTINGS));
    touch("fonts");
  }, [touch]);

  const updateNetworkSettings = useCallback((settings: Partial<NetworkSettings>) => {
    setNetworkSettings((prev) => {
      const next = normalizeNetwork({ ...prev, ...settings });
      void persist(NETWORK_KEY, JSON.stringify(next));
      return next;
    });
    touch("network");
  }, [touch]);

  const updateTranslationSettings = useCallback((settings: Partial<TranslationSettings>) => {
    setTranslationSettings((prev) => {
      const next = normalizeTranslation({ ...prev, ...settings });
      void persist(TRANSLATION_CFG_KEY, JSON.stringify(next));
      return next;
    });
    touch("translation");
  }, [touch]);

  const updateImageProcessingSettings = useCallback((settings: Partial<ImageProcessingSettings>) => {
    setImageProcessingSettings((prev) => {
      const next = normalizeImageProcessing({ ...prev, ...settings });
      void persist(IMAGE_PROCESSING_KEY, JSON.stringify(next));
      return next;
    });
    touch("imageProcessing");
  }, [touch]);

  const restoreSettings = useCallback(async (settings: Partial<{
    readerSettings: ReaderSettings;
    fontSettings: FontSettings;
    networkSettings: NetworkSettings;
    translationSettings: TranslationSettings;
    imageProcessingSettings: ImageProcessingSettings;
    themeMode: ThemeMode;
    geminiModel: GeminiModel;
  }>) => {
    if (settings.readerSettings) updateReaderSettings({ ...settings.readerSettings });
    if (settings.fontSettings) updateFontSettings({ ...settings.fontSettings });
    if (settings.networkSettings) updateNetworkSettings({ ...settings.networkSettings });
    if (settings.translationSettings) updateTranslationSettings({ ...settings.translationSettings });
    if (settings.imageProcessingSettings) updateImageProcessingSettings({ ...settings.imageProcessingSettings });
    if (settings.themeMode && ["auto", "light", "dark"].includes(settings.themeMode)) {
      setThemeMode(settings.themeMode);
    }
    if (settings.geminiModel && VALID_GEMINI_MODELS.includes(settings.geminiModel)) {
      setGeminiModel(settings.geminiModel);
    }
  }, [
    setGeminiModel,
    setThemeMode,
    updateFontSettings,
    updateNetworkSettings,
    updateReaderSettings,
    updateTranslationSettings,
    updateImageProcessingSettings,
  ]);

  return (
    <SettingsContext.Provider
      value={{
        settingsReady,
        settingsLastUpdated,
        readerSettings, updateReaderSettings,
        activeSourceId, setActiveSourceId,
        translationCount, incrementTranslationCount,
        themeMode, setThemeMode,
        geminiModel, setGeminiModel,
        fontSettings, updateFontSettings, resetFontSettings,
        networkSettings, updateNetworkSettings,
        translationSettings, updateTranslationSettings,
        imageProcessingSettings, updateImageProcessingSettings,
        restoreSettings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
