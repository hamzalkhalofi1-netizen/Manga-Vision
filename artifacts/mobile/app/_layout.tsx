import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { setBaseUrl } from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import React, { useEffect } from "react";
import { loadApiBaseOverride, getApiBase } from "@/services/api";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import GlobalWebViewBridge from "@/components/GlobalWebViewBridge";
import { DownloadProvider } from "@/context/DownloadContext";
import { LibraryProvider } from "@/context/LibraryContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { TokenProvider } from "@/context/TokenContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// On web: use relative URLs (routed through dev proxy).
// On native: use the absolute API URL once the async override loads.
// setBaseUrl is called again inside RootLayout once the AsyncStorage
// override is hydrated so the auto-generated API client also picks it up.
setBaseUrl("");

SystemUI.setBackgroundColorAsync("#080808");

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#080808" } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="manga"
        options={{
          headerShown: false,
          presentation: "card",
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="reader"
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          headerShown: false,
          presentation: "card",
          animation: "slide_from_right",
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Load the user-configured API server URL from AsyncStorage at startup.
  // This allows APK/Expo Go users to set their server URL in Settings without
  // needing to rebuild the app. Must run before any API calls are made.
  useEffect(() => {
    loadApiBaseOverride().then(() => {
      // Re-apply base URL for the auto-generated API client now that the
      // AsyncStorage override (if any) has been applied.
      setBaseUrl(getApiBase());
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <SettingsProvider>
            <TokenProvider>
            <LibraryProvider>
              <DownloadProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <GlobalWebViewBridge>
                      <RootLayoutNav />
                    </GlobalWebViewBridge>
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </DownloadProvider>
            </LibraryProvider>
            </TokenProvider>
          </SettingsProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
