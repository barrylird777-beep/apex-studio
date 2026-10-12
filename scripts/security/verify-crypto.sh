#!/usr/bin/env bash
set -euo pipefail

CA="${APEX_CA_DIR:-/srv/apex/secrets/ca}/ca.crt"
TLS_DIR="${APEX_TLS_DIR:-/srv/apex/secrets/tls}"
REQUIRE_TLS13="${APEX_TLS_REQUIRE_13:-false}"

# Cryptographic identity checks below depend on Railway-mounted certificates
# and live private endpoints. Those deployment artifacts do not exist on
# ephemeral GitHub-hosted runners; enforce them normally in production.
if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo "[INFO] CI environment detected. Production crypto mounts and live endpoints are not present; skipping deployment-only cryptographic verification."
  exit 0
fi

TARGETS=(
  "git.apex.internal"
  "registry.apex.internal"
  "webhook.apex.internal"
)

test -r "$CA"

echo "== Local CA =="
openssl x509 -in "$CA" -noout   -subject -issuer -serial -dates -fingerprint -sha256

for host in "${TARGETS[@]}"; do
  cert="$TLS_DIR/$host.crt"
  key="$TLS_DIR/$host.key"
  target="$host:443"

  echo
  echo "========================================"
  echo "== $host =="
  echo "========================================"

  test -r "$cert"
  test -r "$key"

  echo "-- certificate metadata --"
  openssl x509 -in "$cert" -noout     -subject -issuer -dates -ext subjectAltName -fingerprint -sha256

  echo "-- hostname/SAN validation --"
  openssl x509 -in "$cert" -checkhost "$host" -noout

  echo "-- private-key public-key fingerprint --"
  key_fp="$(
    openssl pkey -in "$key" -pubout -outform DER 2>/dev/null |
      openssl dgst -sha256
  )"
  printf '%s\\n' "$key_fp"

  echo "-- certificate public-key fingerprint --"
  cert_fp="$(
    openssl x509 -in "$cert" -pubkey -noout 2>/dev/null |
      openssl pkey -pubin -outform DER 2>/dev/null |
      openssl dgst -sha256
  )"
  printf '%s\\n' "$cert_fp"

  if [[ "$key_fp" != "$cert_fp" ]]; then
    echo "FAIL: private key and certificate public keys do not match." >&2
    exit 1
  fi
  echo "PASS: private key and certificate public keys match."

  echo "-- CA chain verification --"
  openssl verify -CAfile "$CA" "$cert"

  echo "-- live endpoint certificate --"
  live_fp="$(
    openssl s_client       -connect "$target"       -servername "$host"       -CAfile "$CA"       -verify_return_error       -tls1_2 </dev/null 2>/dev/null |
      openssl x509 -noout -fingerprint -sha256
  )"
  local_fp="$(openssl x509 -in "$cert" -noout -fingerprint -sha256)"

  printf 'Configured certificate: %s\\n' "$local_fp"
  printf 'Live endpoint:         %s\\n' "$live_fp"

  if [[ "$live_fp" != "$local_fp" ]]; then
    echo "FAIL: live endpoint certificate does not match the approved certificate file." >&2
    exit 1
  fi
  echo "PASS: live endpoint presents the approved certificate."

  echo "-- TLS 1.2 --"
  openssl s_client     -connect "$target"     -servername "$host"     -CAfile "$CA"     -verify_return_error     -tls1_2 </dev/null 2>&1 |
    grep -E 'Protocol *:|Cipher *:|Verify return code:' || true

  echo "-- TLS 1.3 --"
  if ! openssl s_client       -connect "$target"       -servername "$host"       -CAfile "$CA"       -verify_return_error       -tls1_3 </dev/null >/tmp/apex-tls13.out 2>&1; then
    if [[ "$REQUIRE_TLS13" == "true" ]]; then
      cat /tmp/apex-tls13.out
      rm -f /tmp/apex-tls13.out
      echo "FAIL: TLS 1.3 is required but failed for $host." >&2
      exit 1
    fi
    cat /tmp/apex-tls13.out
    rm -f /tmp/apex-tls13.out
    echo "INFO: TLS 1.3 is unavailable/unsupported; TLS 1.3 is preferred but not required by this verifier."
  else
    grep -E 'Protocol *:|Cipher *:|Verify return code:' /tmp/apex-tls13.out || true
    rm -f /tmp/apex-tls13.out
    echo "PASS: TLS 1.3 accepted."
  fi
done

echo
echo "Cryptographic identity and live TLS verification passed for all configured Apex endpoints."
