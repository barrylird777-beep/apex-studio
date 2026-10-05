#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "FFmpeg is required" >&2; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from .env.example; fill the object-store credentials before starting."
fi

npm install
npm run db:migrate:workers
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save

echo
echo "Worker started: apex-av1-production"
echo "Next: run 'pm2 startup' once to register reboot persistence, then execute the command PM2 prints."
