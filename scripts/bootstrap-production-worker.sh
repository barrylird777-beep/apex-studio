#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "FFmpeg is required" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required for the production durable worker}"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from .env.example; fill the database and object-store credentials before starting."
fi

npm install
npm run db:migrate:workers
npm install -g pm2
APEX_WORKER_ONLY=true pm2 start index.mjs --name apex-autonomous-worker
pm2 save

echo
echo "Worker started: apex-autonomous-worker (PostgreSQL durable worker)"
echo "Next: run 'pm2 startup' once to register reboot persistence, then execute the command PM2 prints."
