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

# ── Kill stale proxy process and free the proxy port only ──────────────────
echo "[start.sh] Freeing proxy port $PORT from stale processes..."
pkill -9 -f "server/proxy.js" 2>/dev/null || true
pid=$(lsof -ti tcp:"$PORT" 2>/dev/null) && kill -9 $pid 2>/dev/null || true
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 1

# ── Detect if Expo is already running (e.g. via artifact workflow) ──────────
EXPO_ALREADY_RUNNING=false
if lsof -ti tcp:"$EXPO_DEV_PORT" >/dev/null 2>&1; then
  echo "[start.sh] Expo already running on port $EXPO_DEV_PORT (artifact workflow detected) — skipping Metro start."
  EXPO_ALREADY_RUNNING=true
else
  # Only kill Metro if we're going to start it ourselves
  echo "[start.sh] Freeing Expo port $EXPO_DEV_PORT..."
  pkill -9 -f "expo start" 2>/dev/null || true
  pkill -9 -f "metro" 2>/dev/null || true
  pkill -9 -f "react-native-packager" 2>/dev/null || true
  fuser -k "${EXPO_DEV_PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

# ── Replit-specific Expo environment ──────────────────────────────────────
export DANGEROUSLY_DISABLE_HOST_CHECK=true

# Replit's built-in HTTPS proxy — gives exp://xxx.expo.picard.replit.dev
# REPLIT_DEV_DOMAIN is always available as a Replit secret.
# Only set if the workflow hasn't already set them.
if [[ -n "${REPLIT_DEV_DOMAIN:-}" && -z "${EXPO_PACKAGER_PROXY_URL:-}" ]]; then
  export EXPO_PACKAGER_PROXY_URL="https://${REPLIT_DEV_DOMAIN}"
  export REACT_NATIVE_PACKAGER_HOSTNAME="${REPLIT_DEV_DOMAIN}"
fi

# EXPO_PUBLIC_API_URL: absolute URL used by native builds (APK / Expo Go) to reach
# the API server. On web the proxy handles /api/* so this is only needed on native.
# Expo inlines EXPO_PUBLIC_* vars at bundle time — must be set before `expo start`.
if [[ -n "${REPLIT_DEV_DOMAIN:-}" && -z "${EXPO_PUBLIC_API_URL:-}" ]]; then
  export EXPO_PUBLIC_API_URL="https://${REPLIT_DEV_DOMAIN}"
fi
echo "[start.sh] EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL:-<not set>}"

# ── Suppress known-unfixable Replit container issues ──────────────────────
# EXPO_NO_DEVTOOLS=1: skip DevTools auto-install (requires libglib absent on Replit).
# DO NOT use CI=1 (disables hot reload) or EXPO_UNSTABLE_HEADLESS=1.
export EXPO_NO_DEVTOOLS=1

# Prevent browser auto-open attempts WITHOUT disabling hot reload.
export BROWSER=none

# Suppress update nag
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

# ── Start Expo Metro (only if not already running) ─────────────────────────
if [[ "$EXPO_ALREADY_RUNNING" == "true" ]]; then
  echo "[start.sh] Expo Metro already running on $EXPO_DEV_PORT — proxy only mode."
  echo "[start.sh] Proxy (port $PORT) → Expo (port $EXPO_DEV_PORT) ready."
  wait "$PROXY_PID"
else
  # --localhost: bind Metro to 127.0.0.1 (proxy handles external access)
  # --clear: wipe Metro's transform cache to avoid stale-bundle crashes
  # No --go / --web: those invoke xdg-open which crashes on headless Replit
  echo "[start.sh] Starting Expo Metro on port $EXPO_DEV_PORT (clearing cache)..."
  echo "[start.sh] Expo Go tunnel URL will appear below once Metro is ready."

  ./node_modules/.bin/expo start \
    --localhost \
    --port "$EXPO_DEV_PORT" \
    --clear \
    &
  EXPO_PID=$!

  wait "$EXPO_PID"
fi
