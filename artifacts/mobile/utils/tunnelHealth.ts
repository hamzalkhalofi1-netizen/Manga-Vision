/**
 * tunnelHealth.ts — Expo tunnel health monitoring for MangaVerse.
 *
 * Provides:
 *   - getTunnelStatus()    — current tunnel state (detected from env + Metro)
 *   - useTunnelStatus()    — React hook for components
 *   - TunnelHealthBanner   — UI banner shown when tunnel is degraded
 *
 * This module is designed for the development environment only.
 * In production builds it returns a permanent "connected" status.
 */

import { useEffect, useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────

export type TunnelMode = "replit-proxy" | "ngrok" | "localhost" | "unknown";

export interface TunnelStatus {
  mode: TunnelMode;
  url: string | null;
  isConnected: boolean;
  isReady: boolean;
  lastCheckedAt: number;
  errorMessage: string | null;
  diagnostics: TunnelDiagnostics;
}

export interface TunnelDiagnostics {
  replitDevDomain: string | null;
  expoPackagerProxyUrl: string | null;
  expoDevPort: number;
  metroReachable: boolean | null;
  roundTripMs: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const METRO_PING_TIMEOUT_MS = 5_000;

// In production, always report healthy (no Metro to check).
const IS_DEV = process.env.NODE_ENV !== "production";

// ── Env detection (read at module load time) ──────────────────────────────

function detectTunnelMode(): TunnelMode {
  const proxyUrl = process.env.EXPO_PACKAGER_PROXY_URL ?? "";
  const metroHostname = process.env.REACT_NATIVE_PACKAGER_HOSTNAME ?? "";

  if (proxyUrl.includes(".replit.dev") || metroHostname.includes(".replit.dev")) {
    return "replit-proxy";
  }
  if (proxyUrl.includes("exp.direct") || proxyUrl.includes("ngrok")) {
    return "ngrok";
  }
  if (proxyUrl === "" && metroHostname === "") {
    return "localhost";
  }
  return "unknown";
}

function detectTunnelUrl(): string | null {
  const proxyUrl = process.env.EXPO_PACKAGER_PROXY_URL;
  const hostname = process.env.REACT_NATIVE_PACKAGER_HOSTNAME;
  const port = parseInt(process.env.EXPO_DEV_PORT ?? "5001", 10);

  if (proxyUrl) {
    // Convert https://xxx.replit.dev → exp://xxx.replit.dev
    return proxyUrl.replace(/^https?:\/\//, "exp://");
  }
  if (hostname) {
    return `exp://${hostname}:${port}`;
  }
  return null;
}

// ── Metro ping ────────────────────────────────────────────────────────────

async function pingMetro(port: number): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), METRO_PING_TIMEOUT_MS);
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return { ok: res.ok, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

// ── Core status getter ────────────────────────────────────────────────────

export async function getTunnelStatus(): Promise<TunnelStatus> {
  // In production, always report healthy.
  if (!IS_DEV) {
    return {
      mode: "unknown",
      url: null,
      isConnected: true,
      isReady: true,
      lastCheckedAt: Date.now(),
      errorMessage: null,
      diagnostics: {
        replitDevDomain: null,
        expoPackagerProxyUrl: null,
        expoDevPort: 0,
        metroReachable: null,
        roundTripMs: null,
      },
    };
  }

  const mode = detectTunnelMode();
  const url = detectTunnelUrl();
  const port = parseInt(process.env.EXPO_DEV_PORT ?? "5001", 10);

  const ping = await pingMetro(port);

  const diagnostics: TunnelDiagnostics = {
    replitDevDomain: process.env.REPLIT_DEV_DOMAIN ?? null,
    expoPackagerProxyUrl: process.env.EXPO_PACKAGER_PROXY_URL ?? null,
    expoDevPort: port,
    metroReachable: ping.ok,
    roundTripMs: ping.ok ? ping.ms : null,
  };

  let errorMessage: string | null = null;

  if (!ping.ok) {
    if (mode === "replit-proxy" && !process.env.EXPO_PACKAGER_PROXY_URL) {
      errorMessage =
        "EXPO_PACKAGER_PROXY_URL not set. Metro URL may not be reachable from Expo Go.";
    } else if (mode === "ngrok") {
      errorMessage =
        "Metro unreachable. ngrok tunnel may have disconnected. Restart: ./scripts/start-expo-tunnel.sh --tunnel";
    } else {
      errorMessage = `Metro on port ${port} unreachable. Run: ./scripts/start-expo-tunnel.sh`;
    }
  }

  return {
    mode,
    url,
    isConnected: ping.ok,
    isReady: ping.ok && url !== null,
    lastCheckedAt: Date.now(),
    errorMessage,
    diagnostics,
  };
}

// ── React hook ────────────────────────────────────────────────────────────

export function useTunnelStatus(): {
  status: TunnelStatus | null;
  loading: boolean;
  refresh: () => void;
} {
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getTunnelStatus();
      setStatus(s);
      if (__DEV__ && s.errorMessage) {
        console.warn("[tunnelHealth]", s.errorMessage);
        console.warn("[tunnelHealth] diagnostics:", JSON.stringify(s.diagnostics, null, 2));
      }
      if (__DEV__ && s.isReady) {
        console.log(
          `[tunnelHealth] mode=${s.mode} url=${s.url} metro=${s.diagnostics.roundTripMs}ms`,
        );
      }
    } catch (err) {
      console.warn("[tunnelHealth] check failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!IS_DEV) return;

    // Initial check
    void refresh();

    // Periodic health checks
    const interval = setInterval(() => {
      void refresh();
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [refresh]);

  return { status, loading, refresh };
}

// ── Log tunnel info at startup (called from app root) ─────────────────────

export function logTunnelInfo(): void {
  if (!IS_DEV) return;

  const mode = detectTunnelMode();
  const url = detectTunnelUrl();

  const modeLabels: Record<TunnelMode, string> = {
    "replit-proxy": "Replit HTTPS proxy (exp://xxx.expo.picard.replit.dev)",
    ngrok: "ngrok tunnel (exp://xxx.exp.direct)",
    localhost: "localhost (LAN only — not reachable over 4G)",
    unknown: "unknown",
  };

  console.log("═══════════════════════════════════════════");
  console.log("[tunnelHealth] Expo tunnel status:");
  console.log(`  mode: ${modeLabels[mode]}`);
  console.log(`  url:  ${url ?? "(not detected)"}`);
  console.log(`  EXPO_PACKAGER_PROXY_URL: ${process.env.EXPO_PACKAGER_PROXY_URL ?? "(unset)"}`);
  console.log(
    `  REACT_NATIVE_PACKAGER_HOSTNAME: ${process.env.REACT_NATIVE_PACKAGER_HOSTNAME ?? "(unset)"}`,
  );
  if (mode === "localhost") {
    console.warn(
      "[tunnelHealth] WARNING: Expo Go on 4G cannot reach localhost. " +
        "Run: ./scripts/start-expo-tunnel.sh",
    );
  }
  console.log("═══════════════════════════════════════════");
}
