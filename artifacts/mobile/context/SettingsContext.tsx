import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type ReadingMode = "vertical" | "horizontal";
export type TargetLanguage = "en" | "es" | "pt" | "fr" | "de" | "ja" | "ko" | "zh" | "ar";
export type ThemeMode = "auto" | "light" | "dark";

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
  // Theme
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  readingMode: "vertical",
  targetLanguage: "en",
  dataSaver: false,
  showPageNumber: true,
};

const SETTINGS_KEY        = "mangaverse_settings";
const SOURCE_KEY          = "mangaverse_source";
const TRANSLATION_COUNT_KEY = "mangaverse_translations";
const THEME_KEY           = "mangaverse_theme";

export const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [activeSourceId, setActiveSourceIdState] = useState("mangadex");
  const [translationCount, setTranslationCount] = useState(0);
  const [themeMode, setThemeModeState] = useState<ThemeMode>("auto");

  useEffect(() => {
    async function load() {
      try {
        const [settingsRaw, sourceRaw, countRaw, themeRaw] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(SOURCE_KEY),
          AsyncStorage.getItem(TRANSLATION_COUNT_KEY),
          AsyncStorage.getItem(THEME_KEY),
        ]);
        if (settingsRaw) setReaderSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) });
        if (sourceRaw) setActiveSourceIdState(sourceRaw);
        if (countRaw) setTranslationCount(parseInt(countRaw, 10) || 0);
        if (themeRaw && ["auto", "light", "dark"].includes(themeRaw)) {
          setThemeModeState(themeRaw as ThemeMode);
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
