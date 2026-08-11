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

// ── Storage keys ────────────────────────────────────────────────────────────

const SETTINGS_KEY          = "mangaverse_settings";
const SOURCE_KEY            = "mangaverse_source";
const TRANSLATION_COUNT_KEY = "mangaverse_translations";
const THEME_KEY             = "mangaverse_theme";
const GEMINI_MODEL_KEY      = "mangaverse_gemini_model";
const FONT_KEY              = "mangaverse_font_settings";
const NETWORK_KEY           = "mangaverse_network_settings";
const TRANSLATION_CFG_KEY   = "mangaverse_translation_settings";

const VALID_GEMINI_MODELS: GeminiModel[] = [
  "gemini-flash-lite-latest",
];

// ── Context type ─────────────────────────────────────────────────────────────

interface SettingsContextType {
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
  restoreSettings: (settings: Partial<{
    readerSettings: ReaderSettings;
    fontSettings: FontSettings;
    networkSettings: NetworkSettings;
    translationSettings: TranslationSettings;
    themeMode: ThemeMode;
    geminiModel: GeminiModel;
  }>) => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(DEFAULT_READER);
  const [activeSourceId, setActiveSourceIdState] = useState("mangadex");
  const [translationCount, setTranslationCount] = useState(0);
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");
  const [geminiModel, setGeminiModelState] = useState<GeminiModel>("gemini-flash-lite-latest");
  const [fontSettings, setFontSettings] = useState<FontSettings>(DEFAULT_FONT_SETTINGS);
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings>(DEFAULT_NETWORK);
  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>(DEFAULT_TRANSLATION);

  useEffect(() => {
    async function load() {
      try {
        const [settingsRaw, sourceRaw, countRaw, themeRaw, modelRaw, fontRaw, networkRaw, translRaw] =
          await Promise.all([
            AsyncStorage.getItem(SETTINGS_KEY),
            AsyncStorage.getItem(SOURCE_KEY),
            AsyncStorage.getItem(TRANSLATION_COUNT_KEY),
            AsyncStorage.getItem(THEME_KEY),
            AsyncStorage.getItem(GEMINI_MODEL_KEY),
            AsyncStorage.getItem(FONT_KEY),
            AsyncStorage.getItem(NETWORK_KEY),
            AsyncStorage.getItem(TRANSLATION_CFG_KEY),
          ]);
        if (settingsRaw) setReaderSettings({ ...DEFAULT_READER, ...JSON.parse(settingsRaw) });
        if (sourceRaw) setActiveSourceIdState(sourceRaw);
        if (countRaw) setTranslationCount(parseInt(countRaw, 10) || 0);
        if (themeRaw && ["auto", "light", "dark"].includes(themeRaw)) {
          setThemeModeState(themeRaw as ThemeMode);
        }
        if (modelRaw && VALID_GEMINI_MODELS.includes(modelRaw as GeminiModel)) {
          setGeminiModelState(modelRaw as GeminiModel);
        }
        if (fontRaw) setFontSettings({ ...DEFAULT_FONT_SETTINGS, ...JSON.parse(fontRaw) });
        if (networkRaw) setNetworkSettings({ ...DEFAULT_NETWORK, ...JSON.parse(networkRaw) });
        if (translRaw) setTranslationSettings({ ...DEFAULT_TRANSLATION, ...JSON.parse(translRaw) });
      } catch {}
    }
    load();
  }, []);

  const updateReaderSettings = useCallback((settings: Partial<ReaderSettings>) => {
    setReaderSettings((prev) => {
      const next = { ...prev, ...settings };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const setActiveSourceId = useCallback((id: string) => {
    setActiveSourceIdState(id);
    AsyncStorage.setItem(SOURCE_KEY, id);
  }, []);

  const incrementTranslationCount = useCallback(() => {
    setTranslationCount((prev) => {
      const next = prev + 1;
      AsyncStorage.setItem(TRANSLATION_COUNT_KEY, String(next));
      return next;
    });
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_KEY, mode);
  }, []);

  const setGeminiModel = useCallback((model: GeminiModel) => {
    setGeminiModelState(model);
    AsyncStorage.setItem(GEMINI_MODEL_KEY, model);
  }, []);

  const updateFontSettings = useCallback((settings: Partial<FontSettings>) => {
    setFontSettings((prev) => {
      const next = { ...prev, ...settings };
      AsyncStorage.setItem(FONT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetFontSettings = useCallback(() => {
    setFontSettings(DEFAULT_FONT_SETTINGS);
    AsyncStorage.setItem(FONT_KEY, JSON.stringify(DEFAULT_FONT_SETTINGS));
  }, []);

  const updateNetworkSettings = useCallback((settings: Partial<NetworkSettings>) => {
    setNetworkSettings((prev) => {
      const next = { ...prev, ...settings };
      AsyncStorage.setItem(NETWORK_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateTranslationSettings = useCallback((settings: Partial<TranslationSettings>) => {
    setTranslationSettings((prev) => {
      const next = { ...prev, ...settings };
      AsyncStorage.setItem(TRANSLATION_CFG_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const restoreSettings = useCallback(async (settings: Partial<{
    readerSettings: ReaderSettings;
    fontSettings: FontSettings;
    networkSettings: NetworkSettings;
    translationSettings: TranslationSettings;
    themeMode: ThemeMode;
    geminiModel: GeminiModel;
  }>) => {
    if (settings.readerSettings) updateReaderSettings({ ...settings.readerSettings });
    if (settings.fontSettings) updateFontSettings({ ...settings.fontSettings });
    if (settings.networkSettings) updateNetworkSettings({ ...settings.networkSettings });
    if (settings.translationSettings) updateTranslationSettings({ ...settings.translationSettings });
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
  ]);

  return (
    <SettingsContext.Provider
      value={{
        readerSettings, updateReaderSettings,
        activeSourceId, setActiveSourceId,
        translationCount, incrementTranslationCount,
        themeMode, setThemeMode,
        geminiModel, setGeminiModel,
        fontSettings, updateFontSettings, resetFontSettings,
        networkSettings, updateNetworkSettings,
        translationSettings, updateTranslationSettings,
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
