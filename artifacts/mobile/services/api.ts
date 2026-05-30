import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * Centralized API base URL resolution.
 *
 * Priority order (native only — web always uses ""):
 *   1. Runtime override stored in AsyncStorage (set from Settings → API Server).
 *      Survives app restarts. Highest priority so users can reconfigure without rebuilding.
 *   2. EXPO_PUBLIC_API_URL — baked in at EAS build time via eas.json env section.
 *   3. Empty string "" — works on web via the dev proxy; throws "Invalid URL" on native.
 *
 * On web: always returns "" so /api/* requests route through the port-5000 dev proxy
 * to the API server at port 3000. No configuration needed.
 *
 * On native (Expo Go / APK): must resolve to an absolute HTTPS URL.
 * If translation throws "Invalid URL": Settings → API Server → enter your Replit domain.
 */

const API_BASE_STORAGE_KEY = "mangaverse_api_base_url_v1";

/** Module-level runtime override — populated from AsyncStorage at app startup. */
let _runtimeOverride: string | null = null;

/** Normalise a URL: trim whitespace and strip trailing slashes. */
function normalise(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getApiBase(): string {
  // Web: always relative — the dev proxy handles routing to port 3000.
  if (Platform.OS === "web") return "";

  // 1. Runtime override (AsyncStorage, configured in Settings).
  if (_runtimeOverride) return _runtimeOverride;

  // 2. Build-time env var (eas.json env section or EAS project secrets).
  const envUrl = normalise(process.env.EXPO_PUBLIC_API_URL ?? "");
  if (envUrl) return envUrl;

  // 3. Fallback — works on web only. Causes "Invalid URL" on native.
  //    If you see that error, set Settings → API Server URL.
  return "";
}

/** Apply a runtime URL override without persisting it. Used internally. */
export function setApiBaseOverride(url: string): void {
  const trimmed = normalise(url);
  _runtimeOverride = trimmed || null;
}

/**
 * Load the persisted API URL from AsyncStorage and apply it as the runtime override.
 * Call once at app startup (before any API requests are made).
 */
export async function loadApiBaseOverride(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(API_BASE_STORAGE_KEY);
    if (saved) setApiBaseOverride(saved);
  } catch {
    // AsyncStorage read failure is non-fatal — fall through to env var / empty.
  }
}

/**
 * Persist a new API URL to AsyncStorage and immediately apply it as the runtime override.
 * Pass an empty string to clear the override and fall back to the env var.
 */
export async function saveApiBaseOverride(url: string): Promise<void> {
  const trimmed = normalise(url);
  setApiBaseOverride(trimmed);
  try {
    if (trimmed) {
      await AsyncStorage.setItem(API_BASE_STORAGE_KEY, trimmed);
    } else {
      await AsyncStorage.removeItem(API_BASE_STORAGE_KEY);
    }
  } catch {}
}

/** Return the currently persisted API URL (for display in Settings). */
export async function getSavedApiBaseUrl(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(API_BASE_STORAGE_KEY)) ?? "";
  } catch {
    return "";
  }
}

/** Return the effective API URL as it will be used at runtime (for display in Settings). */
export function getEffectiveApiBase(): string {
  return getApiBase();
}
