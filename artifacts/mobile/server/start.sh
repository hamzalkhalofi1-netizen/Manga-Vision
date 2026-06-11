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
# IMPORTANT: We do NOT touch Metro/Expo processes here.
# The `artifacts/mobile: expo` Replit artifact workflow manages Metro on port
# $EXPO_DEV_PORT. Killing it causes it to restart on a different port, which
# breaks the EXPO_PACKAGER_PROXY_URL routing and produces an exp.direct URL.
# We coexist: start.sh = proxy only; artifact workflow = Metro.
echo "[start.sh] Freeing proxy port $PORT from stale proxy processes..."
pkill -9 -f "server/proxy.js" 2>/dev/null || true
pid=$(lsof -ti tcp:"$PORT" 2>/dev/null) && kill -9 $pid 2>/dev/null || true
fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 1

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

# ── Start proxy (proxy-only mode) ─────────────────────────────────────────
# Metro is managed by the `artifacts/mobile: expo` Replit artifact workflow.
# start.sh only runs the proxy that routes:
#   /api/*  → API server (port $EXPO_API_PORT)
#   *       → Expo Metro (port $EXPO_DEV_PORT)
echo "[start.sh] Proxy-only mode — Expo Metro managed by artifact workflow."
echo "[start.sh] Starting dev proxy on port $PORT..."
echo "[start.sh] Routes: /api/* → :$EXPO_API_PORT   * → :$EXPO_DEV_PORT"
node server/proxy.js &
PROXY_PID=$!

wait "$PROXY_PID"
