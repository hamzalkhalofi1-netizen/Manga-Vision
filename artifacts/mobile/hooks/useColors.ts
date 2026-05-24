import { useContext } from "react";
import { useColorScheme } from "react-native";
import colors from "@/constants/colors";

// Import the context object directly — NOT the throwing useSettings() hook —
// so we can do a null-safe check. ErrorFallback calls useColors() while sitting
// outside the SettingsProvider tree, so we must handle ctx === null gracefully.
import { SettingsContext } from "@/context/SettingsContext";

/**
 * useColors — returns design tokens for the active theme.
 *
 * Theme resolution order:
 *   1. SettingsContext.themeMode ('light' | 'dark') — manual user override
 *   2. 'auto' → OS color scheme via useColorScheme()
 *   3. Fallback to 'dark' (app default, and ErrorFallback safe-path)
 *
 * Null-safe: works even when rendered outside SettingsProvider
 * (e.g., the global ErrorFallback boundary component).
 */
export function useColors() {
  const osScheme = useColorScheme();
  const ctx = useContext(SettingsContext);
  const themeMode = ctx?.themeMode ?? "auto";

  const resolved =
    themeMode === "auto"
      ? (osScheme ?? "dark")
      : themeMode;

  const palette =
    resolved === "dark" && "dark" in colors
      ? (colors as unknown as Record<string, typeof colors.light>).dark
      : colors.light;

  return { ...palette, radius: colors.radius };
}
