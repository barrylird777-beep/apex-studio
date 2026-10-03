#!/usr/bin/env bash
set -euo pipefail

TLS_DIR="${APEX_TLS_DIR:-/srv/apex/secrets/tls}"
CA_DIR="${APEX_CA_DIR:-/srv/apex/secrets/ca}"

if [ "${CI:-false}" = "true" ] && { [ ! -d "$TLS_DIR" ] || [ ! -d "$CA_DIR" ]; }; then
  echo "CI environment detected; deployment-only TLS/CA directory validation is not applicable."
  echo "TLS directory: $TLS_DIR"
  echo "CA directory: $CA_DIR"
  exit 0
fi

echo "== TLS directory =="
ls -ld "$TLS_DIR"
find "$TLS_DIR" -maxdepth 2 -printf '%M %u:%g %p\\n'

echo
echo "== CA directory =="
ls -ld "$CA_DIR"
find "$CA_DIR" -maxdepth 2 -printf '%M %u:%g %p\\n'

echo
echo "== Private-key filename inventory =="
find "$TLS_DIR" "$CA_DIR" -type f \( -name '*.key' -o -name '*-key.pem' \) -printf '%M %u:%g %p\\n'

echo
echo "== Certificate/PEM inventory =="
find "$TLS_DIR" "$CA_DIR" -type f \( -name '*.crt' -o -name '*.pem' \) -printf '%M %u:%g %p\\n'

echo
echo "== ACLs on secret directories =="
if command -v getfacl >/dev/null 2>&1; then
  getfacl -p "$TLS_DIR" "$CA_DIR"
else
  echo "getfacl unavailable; inspect ACLs with the host's native ACL tooling."
fi

echo
echo "== ACLs on discovered private-key files =="
if command -v getfacl >/dev/null 2>&1; then
  while IFS= read -r -d '' key; do
    echo "--- $key ---"
    getfacl -p "$key"
  done < <(find "$TLS_DIR" "$CA_DIR" -type f \( -name '*.key' -o -name '*-key.pem' \) -print0)
fi

echo
echo "== Symlinks =="
find "$TLS_DIR" "$CA_DIR" -type l -ls

echo
echo "Review requirements:"
echo "- private keys must not be world-readable;"
echo "- unexpected ACL grants must be investigated;"
echo "- unexpected symlinks must be investigated;"
echo "- filename-pattern searches are supplemental and do not define the complete key inventory;"
echo "- permissions must match the actual service account/group requirements;"
echo "- the CA private key must remain outside normal service access.";
