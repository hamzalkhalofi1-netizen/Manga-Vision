import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import React, { useEffect } from "react";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import GlobalWebViewBridge from "@/components/GlobalWebViewBridge";
import { DownloadProvider } from "@/context/DownloadContext";
import { LibraryProvider } from "@/context/LibraryContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { TokenProvider } from "@/context/TokenContext";
import { useColors } from "@/hooks/useColors";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

SystemUI.setBackgroundColorAsync("#080808");

function RootLayoutNav() {
  const colors = useColors();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
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
