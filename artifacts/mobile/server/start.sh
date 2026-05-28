#!/usr/bin/env bash
# Dev proxy + Expo Metro launcher for Replit.
# Port 5000 (proxy): /api/* → API server (3000), * → Expo Metro (5001)
# Expo Metro serves both web (browser preview) and native (Expo Go via tunnel URL).
#
# IMPORTANT: Do NOT add --go or --web flags — they invoke xdg-open which
# always fails on headless Replit containers (no display), crashing the whole script.
# Web bundling works automatically via expo-router without explicit --web flag.
# Expo Go URL is printed by Metro once it starts.

set -uo pipefail
# Note: Not using -e (errexit). Non-fatal errors (DevTools, xdg-open) must not
# kill the script. Errors are handled explicitly below.

export PORT="${PORT:-5000}"
export EXPO_DEV_PORT="${EXPO_DEV_PORT:-5001}"
export EXPO_API_PORT="${EXPO_API_PORT:-3000}"

# ── Kill stale Metro/proxy processes to free the port ─────────────────────
# The 'artifacts/mobile: expo' artifact workflow may already hold port 5001.
# We must free it before starting our own Metro instance.
echo "[start.sh] Freeing port $EXPO_DEV_PORT from any stale Metro process..."
pkill -9 -f "expo start" 2>/dev/null || true
pkill -9 -f "metro" 2>/dev/null || true
pkill -9 -f "react-native-packager" 2>/dev/null || true
# Free port directly if fuser is available
fuser -k "${EXPO_DEV_PORT}/tcp" 2>/dev/null || true
sleep 1

# ── Replit-specific Expo environment ──────────────────────────────────────
# These are already injected by the MangaVerse workflow env, but re-export
# defensively in case this script is called directly.
export DANGEROUSLY_DISABLE_HOST_CHECK=true

# Replit's built-in HTTPS proxy — gives exp://xxx.expo.picard.replit.dev
# This is a real internet-accessible URL that works with Expo Go over 4G.
# Only set if the workflow hasn't already set them.
if [[ -n "${REPLIT_DEV_DOMAIN:-}" && -z "${EXPO_PACKAGER_PROXY_URL:-}" ]]; then
  export EXPO_PACKAGER_PROXY_URL="https://${REPLIT_DEV_DOMAIN}"
  export REACT_NATIVE_PACKAGER_HOSTNAME="${REPLIT_DEV_DOMAIN}"
fi

# ── Suppress known-unfixable Replit container issues ──────────────────────
# EXPO_NO_DEVTOOLS=1: hint to Expo CLI to skip DevTools auto-install.
# @react-native/debugger-shell needs libglib-2.0.so.0 (absent on Ubuntu 24.04
# Replit containers). The resulting error log is cosmetic — Metro keeps running,
# the QR code prints, and hot reload works. This is a known Replit limitation.
# DO NOT use CI=1 (disables hot reload) or EXPO_UNSTABLE_HEADLESS=1 (suppresses
# the QR code and exp:// URL display).
export EXPO_NO_DEVTOOLS=1

# Prevent browser auto-open attempts WITHOUT disabling hot reload.
# CI=1 would disable Metro hot reload — don't use it.
# xdg-open failures were caused by --go/--web flags (now removed).
# BROWSER=none catches any remaining browser-open attempts from tools that respect it.
export BROWSER=none

# Suppress update nag (avoids misleading output in logs)
export EXPO_NO_UPGRADE_CHECK=1

# ── Move to project root ───────────────────────────────────────────────────
cd "$(dirname "$0")/.."

# ── Cleanup trap ───────────────────────────────────────────────────────────
cleanup() {
  kill "$PROXY_PID" 2>/dev/null || true
  kill "$EXPO_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup SIGTERM SIGINT EXIT

# ── Start proxy ────────────────────────────────────────────────────────────
echo "[start.sh] Starting dev proxy on port $PORT..."
node server/proxy.js &
PROXY_PID=$!

# ── Start Expo Metro ───────────────────────────────────────────────────────
# --localhost: bind Metro to 127.0.0.1 (proxy handles external access)
# No --go / --web: those invoke xdg-open which crashes on headless Replit
echo "[start.sh] Starting Expo Metro on port $EXPO_DEV_PORT..."
echo "[start.sh] Expo Go tunnel URL will appear below once Metro is ready."
echo "[start.sh] Tip: run scripts/start-expo-tunnel.sh --tunnel for exp.direct URLs"

./node_modules/.bin/expo start \
  --localhost \
  --port "$EXPO_DEV_PORT" \
  &
EXPO_PID=$!

wait "$EXPO_PID"
