#!/usr/bin/env bash
set -euo pipefail

echo "=== [1/3] Apex Studio: Environment & Configuration Validation ==="

: "${DATABASE_URL:?Error: DATABASE_URL environment variable is required.}"

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"

echo "NODE_ENV=${NODE_ENV}"
echo "PORT=${PORT}"

echo "=== [2/3] Apex Studio: Database Connection Verification ==="

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null

echo "PostgreSQL: OK"

echo "=== [3/3] Apex Studio: Production Spine Ignition ==="

exec npm run start
