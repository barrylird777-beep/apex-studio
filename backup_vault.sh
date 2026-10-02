#!/bin/bash
set -euo pipefail
umask 077
BACKUP_DIR="./.apex_vault_backups"
SOURCE_DIR="./.apex_vault"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
[ -d "$SOURCE_DIR" ] || { echo "[ERROR] $SOURCE_DIR is missing."; exit 1; }
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/apex_backup_$TIMESTAMP.tar.gz" -C "$SOURCE_DIR" .
ls -1t "$BACKUP_DIR"/apex_backup_*.tar.gz | tail -n +6 | while read -r f; do rm -f -- "$f"; done
echo "[SUCCESS] Backup saved: apex_backup_$TIMESTAMP.tar.gz"