#!/usr/bin/env bash
set -euo pipefail

SE_X_CONTAINER="${APEX_SEX_CONTAINER:-apex-se-x}"
SE_X_NETWORK="${APEX_SEX_NETWORK:-apex-search}"
CORE_CONTAINER="${APEX_CORE_CONTAINER:-}"
POSTGRES_HOST="${APEX_POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${APEX_POSTGRES_PORT:-5432}"
PUBLIC_TEST_URL="${APEX_PUBLIC_TEST_URL:-https://example.com}"

if ! command -v docker >/dev/null 2>&1; then
  echo "FAIL: Docker is required for the SE-X network boundary verifier."
  exit 1
fi

if ! docker network inspect "$SE_X_NETWORK" >/dev/null 2>&1; then
  echo "FAIL: required network $SE_X_NETWORK does not exist."
  exit 1
fi

if ! docker inspect "$SE_X_CONTAINER" >/dev/null 2>&1; then
  echo "FAIL: required container $SE_X_CONTAINER does not exist."
  exit 1
fi

echo "== Dedicated network membership =="
docker network inspect "$SE_X_NETWORK" --format='{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}'

echo
echo "== SE-X -> PostgreSQL boundary =="
if docker exec "$SE_X_CONTAINER" sh -c "nc -z -w 3 '$POSTGRES_HOST' '$POSTGRES_PORT'" >/dev/null 2>&1; then
  echo "FAIL: SE-X reached $POSTGRES_HOST:$POSTGRES_PORT"
  exit 1
else
  echo "PASS: SE-X could not establish a TCP connection to $POSTGRES_HOST:$POSTGRES_PORT"
fi

echo
echo "== Core -> public Internet boundary =="
if [[ -n "$CORE_CONTAINER" ]]; then
  if docker exec "$CORE_CONTAINER" sh -c "curl -fsS --max-time 5 '$PUBLIC_TEST_URL' >/dev/null" >/dev/null 2>&1; then
    echo "FAIL: core container has public egress"
    exit 1
  else
    echo "PASS: core container public egress was blocked"
  fi
else
  echo "SKIP: set APEX_CORE_CONTAINER to test the core container."
fi

echo
echo "== SE-X -> public HTTPS =="
if docker exec "$SE_X_CONTAINER" sh -c "curl -fsSI --max-time 8 '$PUBLIC_TEST_URL' >/dev/null" >/dev/null 2>&1; then
  echo "PASS: SE-X can reach the public HTTPS test endpoint"
else
  echo "FAIL: SE-X could not reach the public HTTPS test endpoint"
  exit 1
fi

echo
echo "Boundary test complete. Repeat with the actual internal database hostname/IP and approved public endpoint for the deployment."
