import { Platform } from "react-native";

/**
 * Returns the correct API base URL for the current runtime environment.
 *
 * - Web (Replit preview / browser): "" — relative URLs are routed through the
 *   dev proxy at port 5000 to the API server at port 3000. No config needed.
 *
 * - Native (Expo Go / APK): EXPO_PUBLIC_API_URL must be set to the public
 *   HTTPS URL of the Replit dev domain (e.g. https://xxx.replit.dev).
 *   Without this, fetch("/api/...") throws "Invalid URL" on native because
 *   React Native has no browser context to resolve relative paths.
 *
 * Usage:
 *   import { getApiBase } from "@/services/api";
 *   const res = await fetch(`${getApiBase()}/api/translate-image`, options);
 */
export function getApiBase(): string {
  if (Platform.OS === "web") {
    // Relative URL — the dev proxy (port 5000) routes /api/* to the API server.
    return "";
  }
  // Native (APK / Expo Go): requires an absolute URL.
  const configured = (process.env.EXPO_PUBLIC_API_URL ?? "").trim();
  if (configured) {
    return configured.replace(/\/+$/, ""); // strip any trailing slash
  }
  // Fallback: empty string (works only when running inside Replit web preview).
  // If you see "Invalid URL" in Expo Go, set EXPO_PUBLIC_API_URL in the workflow.
  return "";
}
