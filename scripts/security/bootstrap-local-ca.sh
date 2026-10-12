#!/usr/bin/env bash
set -euo pipefail

BASE="${APEX_CA_DIR:-/srv/apex/secrets/ca}"
TLS="${APEX_TLS_DIR:-/srv/apex/secrets/tls}"
DAYS="${APEX_CA_VALIDITY_DAYS:-3650}"

umask 077
install -d -m 700 "$BASE" "$TLS"

if [[ -e "$BASE/ca.key" || -e "$BASE/ca.crt" ]]; then
  echo "Refusing to overwrite an existing CA. Back it up and rotate it deliberately."
  exit 1
fi

openssl ecparam -name secp384r1 -genkey -noout -out "$BASE/ca.key"
chmod 600 "$BASE/ca.key"

openssl req -x509 -new -sha384 -key "$BASE/ca.key"   -out "$BASE/ca.crt" -days "$DAYS"   -subj "/CN=APEX Internal Root CA"   -addext "basicConstraints=critical,CA:TRUE,pathlen:1"   -addext "keyUsage=critical,keyCertSign,cRLSign"   -addext "subjectKeyIdentifier=hash"

chmod 644 "$BASE/ca.crt"

echo "Created:"
echo "  CA private key: $BASE/ca.key (0600)"
echo "  CA certificate: $BASE/ca.crt (0644)"
echo "Do not copy the private key into Git or a container image."
