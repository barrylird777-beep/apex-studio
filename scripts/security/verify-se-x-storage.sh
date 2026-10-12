#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${APEX_SEX_CONTAINER:-apex-se-x}"

# The SE-X container is a deployment/runtime artifact and is not created by
# GitHub-hosted CI. Keep this check mandatory wherever that container exists,
# while allowing the repository security suite to run on ephemeral CI runners.
if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "[INFO] CI environment detected. SE-X runtime container is not present; skipping deployment-only storage inspection."
    exit 0
  fi
fi

echo "== Container mounts =="
docker inspect --format='{{json .Mounts}}' "$CONTAINER"

echo
echo "== Container tmpfs =="
docker inspect --format='{{json .HostConfig.Tmpfs}}' "$CONTAINER"

echo
echo "== Create ephemeral marker =="
docker exec "$CONTAINER" sh -c 'printf "%s" EPHEMERAL_TEST > /tmp/apex-ephemeral-test'
docker exec "$CONTAINER" sh -c 'cat /tmp/apex-ephemeral-test'

echo
echo "== Restart container =="
docker restart "$CONTAINER" >/dev/null

echo
echo "== Verify marker disappeared =="
docker exec "$CONTAINER" sh -c 'test ! -e /tmp/apex-ephemeral-test && echo EPHEMERAL_OK || { echo PERSISTED; exit 1; }'

echo
echo "PASS: the tested /tmp marker did not survive the container restart."
echo "NOTE: this proves only the tested location is ephemeral; inspect all mounts separately."
