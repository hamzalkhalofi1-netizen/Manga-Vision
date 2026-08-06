import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { GeminiModel } from "@/services/geminiKeyTest";

export type ReadingMode = "vertical" | "horizontal";
export type TargetLanguage = "en" | "es" | "pt" | "fr" | "de" | "ja" | "ko" | "zh" | "ar";
export type ThemeMode = "auto" | "light" | "dark";
export type { GeminiModel };

export interface ReaderSettings {
  readingMode: ReadingMode;
  targetLanguage: TargetLanguage;
  dataSaver: boolean;
  showPageNumber: boolean;
}

interface SettingsContextType {
  readerSettings: ReaderSettings;
  updateReaderSettings: (settings: Partial<ReaderSettings>) => void;
  activeSourceId: string;
  setActiveSourceId: (id: string) => void;
  translationCount: number;
  incrementTranslationCount: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  geminiModel: GeminiModel;
  setGeminiModel: (model: GeminiModel) => void;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  readingMode: "vertical",
  targetLanguage: "en",
  dataSaver: false,
  showPageNumber: true,
};

const SETTINGS_KEY          = "mangaverse_settings";
const SOURCE_KEY            = "mangaverse_source";
const TRANSLATION_COUNT_KEY = "mangaverse_translations";
const THEME_KEY             = "mangaverse_theme";
const GEMINI_MODEL_KEY      = "mangaverse_gemini_model";

const VALID_GEMINI_MODELS: GeminiModel[] = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash-lite",
];

export const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [activeSourceId, setActiveSourceIdState] = useState("mangadex");
  const [translationCount, setTranslationCount] = useState(0);
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");
  const [geminiModel, setGeminiModelState] = useState<GeminiModel>("gemini-2.5-flash");

  useEffect(() => {
    async function load() {
      try {
        const [settingsRaw, sourceRaw, countRaw, themeRaw, modelRaw] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(SOURCE_KEY),
          AsyncStorage.getItem(TRANSLATION_COUNT_KEY),
          AsyncStorage.getItem(THEME_KEY),
          AsyncStorage.getItem(GEMINI_MODEL_KEY),
        ]);
        if (settingsRaw) setReaderSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) });
        if (sourceRaw) setActiveSourceIdState(sourceRaw);
        if (countRaw) setTranslationCount(parseInt(countRaw, 10) || 0);
        if (themeRaw && ["auto", "light", "dark"].includes(themeRaw)) {
          setThemeModeState(themeRaw as ThemeMode);
        }
        if (modelRaw && VALID_GEMINI_MODELS.includes(modelRaw as GeminiModel)) {
          setGeminiModelState(modelRaw as GeminiModel);
        }
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

  return (
    <SettingsContext.Provider
      value={{
        readerSettings,
        updateReaderSettings,
        activeSourceId,
        setActiveSourceId,
        translationCount,
        incrementTranslationCount,
        themeMode,
        setThemeMode,
        geminiModel,
        setGeminiModel,
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
