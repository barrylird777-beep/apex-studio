#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "FFmpeg is required" >&2; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from .env.example. Configure APEX_WORKER_API_URL, APEX_WORKER_TOKEN, and required provider/object-store credentials, then rerun."
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${APEX_WORKER_API_URL:?APEX_WORKER_API_URL is required for the Pure-WAL remote worker}"
: "${APEX_WORKER_TOKEN:?APEX_WORKER_TOKEN is required for the Pure-WAL remote worker}"

npm install
npm install -g pm2
APEX_WORKER_ONLY=true pm2 start index.mjs --name apex-autonomous-worker --update-env
pm2 save

echo
echo "Worker started: apex-autonomous-worker (authenticated Pure-WAL remote queue)"
echo "Next: run 'pm2 startup' once to register reboot persistence, then execute the command PM2 prints."
