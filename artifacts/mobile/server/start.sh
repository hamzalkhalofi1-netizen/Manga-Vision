#!/usr/bin/env bash
# Starts the dev proxy on PORT (default 5000) and Expo on EXPO_DEV_PORT (default 5001).
# The proxy forwards /api/* to EXPO_API_PORT (default 3000) and
# everything else to the Expo dev server, giving the browser a single origin.

set -euo pipefail

export PORT="${PORT:-5000}"
export EXPO_DEV_PORT="${EXPO_DEV_PORT:-5001}"
export EXPO_API_PORT="${EXPO_API_PORT:-3000}"

cd "$(dirname "$0")/.."

# Trap SIGTERM/SIGINT so both child processes are cleaned up on exit
cleanup() {
  kill "$PROXY_PID" 2>/dev/null || true
  kill "$EXPO_PID" 2>/dev/null || true
  wait
}
trap cleanup SIGTERM SIGINT EXIT

node server/proxy.js &
PROXY_PID=$!

DANGEROUSLY_DISABLE_HOST_CHECK=true \
  pnpm exec expo start --localhost --port "$EXPO_DEV_PORT" \
  --go \
  --web &
EXPO_PID=$!

wait "$EXPO_PID"
