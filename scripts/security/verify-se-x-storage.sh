#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${APEX_SEX_CONTAINER:-apex-se-x}"

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
