import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";

export default function SettingsLayout() {
  const colors = useColors();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "slide_from_right",
      }}
    />
  );
}
