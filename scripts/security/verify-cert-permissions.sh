#!/usr/bin/env bash
set -euo pipefail

TLS_DIR="${APEX_TLS_DIR:-/srv/apex/secrets/tls}"
CA_DIR="${APEX_CA_DIR:-/srv/apex/secrets/ca}"

echo "== TLS directory =="
ls -ld "$TLS_DIR"
find "$TLS_DIR" -maxdepth 2 -printf '%M %u:%g %p\n'

echo
echo "== CA directory =="
ls -ld "$CA_DIR"
find "$CA_DIR" -maxdepth 2 -printf '%M %u:%g %p\n'

echo
echo "== Private keys =="
find "$TLS_DIR" "$CA_DIR" -type f \( -name '*.key' -o -name '*-key.pem' \) -printf '%M %u:%g %p\n'

echo
echo "== Certificates =="
find "$TLS_DIR" "$CA_DIR" -type f \( -name '*.crt' -o -name '*.pem' \) -printf '%M %u:%g %p\n'

echo
echo "== ACLs =="
getfacl -p "$TLS_DIR" "$CA_DIR" 2>/dev/null || echo "getfacl unavailable; inspect ACLs with the host's native ACL tooling."

echo
echo "== Symlinks =="
find "$TLS_DIR" "$CA_DIR" -type l -ls

echo
echo "Review requirement:"
echo "- private keys must not be world-readable;"
echo "- unexpected ACL grants must be removed;"
echo "- unexpected symlinks must be investigated;"
echo "- permissions must match the actual service account/group requirements."
