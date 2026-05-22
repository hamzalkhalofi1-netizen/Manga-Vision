import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "mangaverse_inpaint_server_url";

export function useInpaintServer() {
  const [serverUrl, setServerUrlState] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val) setServerUrlState(val);
      setLoading(false);
    });
  }, []);

  const setServerUrl = useCallback(async (url: string) => {
    const trimmed = url.trim().replace(/\/$/, "");
    await AsyncStorage.setItem(STORAGE_KEY, trimmed);
    setServerUrlState(trimmed);
  }, []);

  const clearServerUrl = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setServerUrlState("");
  }, []);

  return { serverUrl, setServerUrl, clearServerUrl, loading };
}
