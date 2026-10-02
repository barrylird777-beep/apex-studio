#!/bin/bash
set -euo pipefail
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${APEX_COMMANDER_TOKEN:?Set APEX_COMMANDER_TOKEN (openssl rand -hex 32)}"
if [ "$APEX_COMMANDER_TOKEN" = "change-me" ]; then echo "[ERROR] APEX_COMMANDER_TOKEN is still the placeholder."; exit 1; fi
export DISABLE_TELEMETRY=true
export APEX_ENV=production_sandboxed
export APEX_BIND_HOST="${APEX_BIND_HOST:-127.0.0.1}"
echo "[DEPLOY] Installing production dependencies..."
npm ci --omit=dev
echo "[DEPLOY] Starting on ${APEX_BIND_HOST}:${PORT:-3000}"
exec node server.mjs