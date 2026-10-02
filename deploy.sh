#!/bin/bash
set -euo pipefail
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${APEX_COMMANDER_TOKEN:?Set APEX_COMMANDER_TOKEN}"
[ "$APEX_COMMANDER_TOKEN" = "change-me" ] && { echo "[ERROR] placeholder token"; exit 1; }
export DISABLE_TELEMETRY=true APEX_ENV=production_sandboxed
export APEX_BIND_HOST="${APEX_BIND_HOST:-127.0.0.1}"
npm ci --omit=dev
exec node server.mjs