#!/bin/bash
set -euo pipefail
umask 077
SOURCE_DIR="./.apex_vault";BACKUP_DIR="./.apex_vault_backups";TIMESTAMP=$(date +%Y%m%d_%H%M%S)
[ -d "$SOURCE_DIR" ] || exit 1
mkdir -p "$BACKUP_DIR";chmod 700 "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/apex_backup_$TIMESTAMP.tar.gz" -C "$SOURCE_DIR" .
ls -1t "$BACKUP_DIR"/apex_backup_*.tar.gz | tail -n +6 | while read -r f;do rm -f -- "$f";done