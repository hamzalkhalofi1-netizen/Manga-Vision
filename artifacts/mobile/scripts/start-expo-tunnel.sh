#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# MangaVerse — Production-grade Expo tunnel launcher for Replit
# ═══════════════════════════════════════════════════════════════════════════
#
# USAGE:
#   ./scripts/start-expo-tunnel.sh           # Replit proxy (exp://xxx.expo.picard.replit.dev)
#   ./scripts/start-expo-tunnel.sh --tunnel  # ngrok tunnel (exp://xxx.exp.direct)
#   ./scripts/start-expo-tunnel.sh --help
#
# WHAT IT DOES:
#   1. Kills stale Metro/ngrok/proxy processes
#   2. Cleans Metro cache and stale ngrok sessions
#   3. Sets all required Replit + Expo env vars
#   4. Starts dev proxy on PORT (default 5000)
#   5. Starts Expo Metro with correct tunnel configuration
#   6. Retries automatically on failure (up to 3 attempts)
#   7. Prints exp:// URL and QR code once Metro is ready
#
# WHY TWO MODES?
#   Replit proxy (default): Uses EXPO_PACKAGER_PROXY_URL to give
#     exp://xxx.expo.picard.replit.dev — reliable, no external deps.
#   Ngrok tunnel (--tunnel): Uses @expo/ngrok@4.1.0 to give
#     exp://xxx.exp.direct — requires @expo/ngrok installed.
#
# KNOWN ISSUES HANDLED:
#   - libglib-2.0.so.0 missing: @react-native/debugger-shell crashes on Ubuntu
#     24.04 Replit containers. Fixed via EXPO_NO_DEVTOOLS=1. NON-FATAL — Metro runs.
#   - xdg-open failures: --go/--web flags trigger browser opens on headless
#     servers. Fixed by removing those flags and setting CI=1.
#   - @expo/ngrok body undefined: Bug in @expo/ngrok@4.1.2+. Fixed by pinning
#     to 4.1.0 in package.json.
#   - Metro host check: Metro rejects non-localhost Host headers from Replit's
#     proxy. Fixed by DANGEROUSLY_DISABLE_HOST_CHECK=true.
#   - Multiple Metro instances: Stale Metro processes block port 5001.
#     Fixed by pkill cleanup at startup.
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Terminal colors ────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ts()   { date '+%H:%M:%S'; }
log()  { echo -e "${BLUE}[$(ts) tunnel]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(ts) tunnel]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[$(ts) tunnel]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[$(ts) tunnel]${NC} ✗ $*"; }
sep()  { echo -e "${CYAN}═══════════════════════════════════════════${NC}"; }

# ── Parse arguments ────────────────────────────────────────────────────────
USE_NGROK=false
SHOW_HELP=false
for arg in "$@"; do
  case "$arg" in
    --tunnel) USE_NGROK=true ;;
    --help|-h) SHOW_HELP=true ;;
  esac
done

if [[ "$SHOW_HELP" == "true" ]]; then
  cat <<EOF
MangaVerse Expo tunnel launcher

USAGE:
  ./scripts/start-expo-tunnel.sh           Replit proxy mode (default)
  ./scripts/start-expo-tunnel.sh --tunnel  ngrok exp.direct mode
  ./scripts/start-expo-tunnel.sh --help    Show this help

MODES:
  Default (Replit proxy):
    Generates exp://xxx.expo.picard.replit.dev
    Works with Expo Go over 4G. No ngrok required.
    Uses Replit HTTPS proxy via EXPO_PACKAGER_PROXY_URL.

  Tunnel (--tunnel):
    Generates exp://xxx.exp.direct via @expo/ngrok@4.1.0
    Requires @expo/ngrok package installed.
    Falls back to Replit proxy if ngrok fails.
EOF
  exit 0
fi

# ── Ports ──────────────────────────────────────────────────────────────────
export PORT="${PORT:-5000}"
export EXPO_DEV_PORT="${EXPO_DEV_PORT:-5001}"
export EXPO_API_PORT="${EXPO_API_PORT:-3000}"

sep
echo -e "${BOLD}  MangaVerse Expo Tunnel Launcher${NC}"
echo -e "  Mode: $([ "$USE_NGROK" == "true" ] && echo "${CYAN}ngrok (exp.direct)${NC}" || echo "${GREEN}Replit proxy${NC}")"
echo -e "  Ports: proxy=$PORT, metro=$EXPO_DEV_PORT, api=$EXPO_API_PORT"
sep

# ── Step 1: Kill stale processes ────────────────────────────────────────────
log "Step 1/6: Killing stale Metro, ngrok, and proxy processes..."

# Kill by pattern (non-fatal if nothing found)
pkill -9 -f "metro" 2>/dev/null || true
pkill -9 -f "expo start" 2>/dev/null || true
pkill -9 -f "expo/cli" 2>/dev/null || true
pkill -9 -f "ngrok" 2>/dev/null || true
pkill -9 -f "server/proxy.js" 2>/dev/null || true

# Free Expo port if occupied
if command -v fuser &>/dev/null; then
  fuser -k "${EXPO_DEV_PORT}/tcp" 2>/dev/null || true
fi

sleep 1
ok "Process cleanup done."

# ── Step 2: Clean caches ─────────────────────────────────────────────────
log "Step 2/6: Cleaning Metro cache and stale ngrok sessions..."

cd "$MOBILE_ROOT"

# Metro cache (temp files)
rm -rf /tmp/metro-* /tmp/haste-map-* /tmp/react-native-packager-cache-* 2>/dev/null || true
# Expo cache markers (not the full .expo dir — that holds important config)
rm -f .expo/metro-* .expo/metro.config.md5 2>/dev/null || true
# Stale ngrok auth/session artifacts
rm -f /tmp/ngrok-* 2>/dev/null || true

ok "Cache clean done."

# ── Step 3: Validate @expo/ngrok if tunnel mode ───────────────────────────
if [[ "$USE_NGROK" == "true" ]]; then
  log "Step 3/6: Validating @expo/ngrok installation..."
  NGROK_PKG="$MOBILE_ROOT/node_modules/@expo/ngrok"
  if [[ ! -d "$NGROK_PKG" ]]; then
    warn "@expo/ngrok not found in node_modules."
    warn "Run: pnpm --filter @workspace/mobile add -D @expo/ngrok@4.1.0"
    warn "Falling back to Replit proxy mode."
    USE_NGROK=false
  else
    NGROK_VER=$(node -e "try{console.log(require('$NGROK_PKG/package.json').version)}catch{console.log('unknown')}" 2>/dev/null || echo "unknown")
    ok "@expo/ngrok@$NGROK_VER found."
  fi
else
  log "Step 3/6: Skipping ngrok validation (Replit proxy mode)."
fi

# ── Step 4: Set environment variables ────────────────────────────────────
log "Step 4/6: Setting environment variables..."

# ── Always set ──────────────────────────────────────────────────────────
# Prevent Metro from rejecting non-localhost Host headers (Replit proxy sends
# the external domain as Host). Required for both modes.
export DANGEROUSLY_DISABLE_HOST_CHECK=true

# Disable React Native DevTools auto-install.
# @react-native/debugger-shell requires libglib-2.0.so.0 which is NOT present
# on Ubuntu 24.04 Replit containers. EXPO_NO_DEVTOOLS=1 skips the install.
export EXPO_NO_DEVTOOLS=1
export REACT_NATIVE_DEVTOOLS=false

# Prevent all browser/app auto-open attempts.
# xdg-open always fails on headless Replit containers (no display server).
# CI=1 is the most reliable way to suppress all interactive/open behaviors.
export CI=1
export BROWSER=none
export EXPO_NO_BROWSER=1

# Suppress update nag banners in logs
export EXPO_NO_UPGRADE_CHECK=1

# Expose Repl ID for any in-app Replit features
export EXPO_PUBLIC_REPL_ID="${REPL_ID:-}"

# ── Mode-specific env ───────────────────────────────────────────────────
if [[ "$USE_NGROK" == "false" ]]; then
  # Replit proxy mode: tell Metro to advertise the external Replit domain
  # instead of 127.0.0.1. This produces exp://xxx.expo.picard.replit.dev.
  if [[ -n "${REPLIT_DEV_DOMAIN:-}" ]]; then
    export EXPO_PACKAGER_PROXY_URL="https://${REPLIT_DEV_DOMAIN}"
    export REACT_NATIVE_PACKAGER_HOSTNAME="${REPLIT_DEV_DOMAIN}"
    log "Replit proxy URL: https://${REPLIT_DEV_DOMAIN}"
    log "Expo Go will connect to: exp://${REPLIT_DEV_DOMAIN}"
  else
    warn "REPLIT_DEV_DOMAIN not set. Metro will use localhost (LAN only)."
    unset EXPO_PACKAGER_PROXY_URL 2>/dev/null || true
  fi
  EXPO_START_CMD="--localhost --port $EXPO_DEV_PORT"
else
  # ngrok tunnel mode: use Expo's built-in tunnel which calls @expo/ngrok
  # to create an exp://xxx.exp.direct URL.
  unset EXPO_PACKAGER_PROXY_URL 2>/dev/null || true
  unset REACT_NATIVE_PACKAGER_HOSTNAME 2>/dev/null || true
  EXPO_START_CMD="--tunnel --port $EXPO_DEV_PORT"
fi

ok "Environment ready."
log "  EXPO_NO_DEVTOOLS=1, CI=1, DANGEROUSLY_DISABLE_HOST_CHECK=true"

# ── Step 5: Start dev proxy ───────────────────────────────────────────────
log "Step 5/6: Starting dev proxy (port $PORT → metro:$EXPO_DEV_PORT, api:$EXPO_API_PORT)..."
PROXY_PID=""
EXPO_PID=""

cleanup() {
  log "Shutting down gracefully..."
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  [[ -n "$EXPO_PID" ]]  && kill "$EXPO_PID"  2>/dev/null || true
  pkill -f "metro" 2>/dev/null || true
  wait 2>/dev/null || true
  log "Done."
}
trap cleanup SIGTERM SIGINT EXIT

node "$MOBILE_ROOT/server/proxy.js" &
PROXY_PID=$!
sleep 0.5

if ! kill -0 "$PROXY_PID" 2>/dev/null; then
  err "Proxy failed to start. Check server/proxy.js."
  exit 1
fi
ok "Proxy running (pid $PROXY_PID)."

# ── Step 6: Start Expo Metro with retry ───────────────────────────────────
log "Step 6/6: Starting Expo Metro bundler..."
sep

MAX_RETRIES=3
ATTEMPT=0
RETRY_DELAY=8

while [[ $ATTEMPT -lt $MAX_RETRIES ]]; do
  ATTEMPT=$((ATTEMPT + 1))

  if [[ $ATTEMPT -gt 1 ]]; then
    warn "Retry $ATTEMPT/$MAX_RETRIES in ${RETRY_DELAY}s..."
    # Clean Metro temp before each retry
    rm -rf /tmp/metro-* /tmp/haste-map-* 2>/dev/null || true
    rm -f "$MOBILE_ROOT/.expo/metro.config.md5" 2>/dev/null || true
    sleep "$RETRY_DELAY"

    # On tunnel mode retry, fall back to Replit proxy if ngrok keeps failing
    if [[ "$USE_NGROK" == "true" && $ATTEMPT -ge 2 ]]; then
      warn "ngrok failed on attempt $((ATTEMPT-1)). Falling back to Replit proxy mode."
      USE_NGROK=false
      if [[ -n "${REPLIT_DEV_DOMAIN:-}" ]]; then
        export EXPO_PACKAGER_PROXY_URL="https://${REPLIT_DEV_DOMAIN}"
        export REACT_NATIVE_PACKAGER_HOSTNAME="${REPLIT_DEV_DOMAIN}"
      fi
      EXPO_START_CMD="--localhost --port $EXPO_DEV_PORT"
    fi
  fi

  log "Attempt $ATTEMPT/$MAX_RETRIES: expo start $EXPO_START_CMD"

  # Start Metro. Pipe stderr→stdout so we can filter known-benign errors,
  # but tee to a log file so nothing is permanently lost.
  EXPO_LOG="/tmp/expo-metro-$$.log"

  # shellcheck disable=SC2086
  "$MOBILE_ROOT/node_modules/.bin/expo" start $EXPO_START_CMD 2>&1 | \
    tee "$EXPO_LOG" | \
    while IFS= read -r line; do
      # ── Filter known-benign Replit errors from display ──────────────────
      # 1. libglib DevTools crash (non-fatal, Metro still runs)
      if echo "$line" | grep -q "libglib-2.0.so.0"; then
        warn "[DevTools] Skipping: libglib-2.0.so.0 not available on Replit. (Metro continues)"
        continue
      fi
      # 2. xdg-open failures (non-fatal)
      if echo "$line" | grep -q "xdg-open"; then
        continue
      fi
      # 3. ngrok body undefined — surface clearly
      if echo "$line" | grep -q "Cannot read properties of undefined.*body"; then
        err "[ngrok] 'body undefined' error — @expo/ngrok version issue."
        err "[ngrok] Fix: ensure @expo/ngrok@4.1.0 is installed (not 4.1.2+)."
        echo "$line"
        continue
      fi
      # ── Highlight important lines ────────────────────────────────────────
      if echo "$line" | grep -qE "exp://|exp\.direct"; then
        echo -e "${GREEN}${BOLD}$line${NC}"
        sep
        echo -e "${GREEN}${BOLD}  ▶ EXPO GO URL READY — Scan QR or open in Expo Go${NC}"
        sep
      elif echo "$line" | grep -qiE "error|failed|crash"; then
        echo -e "${YELLOW}$line${NC}"
      else
        echo "$line"
      fi
    done &
  EXPO_PID=$!

  wait "$EXPO_PID"
  EXPO_EXIT=$?

  if [[ $EXPO_EXIT -eq 0 || $EXPO_EXIT -eq 130 ]]; then
    ok "Expo Metro exited cleanly (code $EXPO_EXIT)."
    break
  fi

  err "Expo Metro exited with code $EXPO_EXIT."
  if [[ -f "$EXPO_LOG" ]]; then
    LAST_LINES=$(tail -5 "$EXPO_LOG" 2>/dev/null)
    if echo "$LAST_LINES" | grep -q "Cannot read properties of undefined"; then
      err "Detected ngrok 'body undefined' error."
      err "Ensure @expo/ngrok@4.1.0 is installed: pnpm --filter @workspace/mobile add -D @expo/ngrok@4.1.0"
    fi
  fi

  if [[ $ATTEMPT -ge $MAX_RETRIES ]]; then
    err "All $MAX_RETRIES attempts failed."
    err "Diagnostics saved to: $EXPO_LOG"
    exit 1
  fi
done
