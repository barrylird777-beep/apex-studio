#!/usr/bin/env bash
set -euo pipefail

CA="${APEX_CA_DIR:-/srv/apex/secrets/ca}/ca.crt"
TLS_DIR="${APEX_TLS_DIR:-/srv/apex/secrets/tls}"
REQUIRE_TLS13="${APEX_TLS_REQUIRE_13:-false}"

TARGETS=(
  "${APEX_GIT_TLS_TARGET:-git.apex.internal:443}"
  "${APEX_REGISTRY_TLS_TARGET:-registry.apex.internal:443}"
  "${APEX_WEBHOOK_TLS_TARGET:-webhook.apex.internal:443}"
)

test -r "$CA"

check_live_tls() {
  local target="$1"
  local version="$2"
  local host="${target%%:*}"
  local tmp
  tmp="$(mktemp)"

  if ! openssl s_client       -connect "$target"       -servername "$host"       -CAfile "$CA"       -verify_return_error       "-$version"       </dev/null >"$tmp" 2>&1; then
    cat "$tmp"
    rm -f "$tmp"
    return 1
  fi

  grep -q 'Verify return code: 0 (ok)' "$tmp"
  grep -E 'Protocol *:|Cipher *:|Verify return code:' "$tmp" || true
  rm -f "$tmp"
}

for target in "${TARGETS[@]}"; do
  host="${target%%:*}"
  cert="$TLS_DIR/$host.crt"
  key="$TLS_DIR/$host.key"

  echo "== $target =="

  test -r "$cert"
  test -r "$key"

  echo "-- certificate metadata --"
  openssl x509 -in "$cert" -noout     -subject -issuer -dates -ext subjectAltName -fingerprint -sha256

  echo "-- certificate chain --"
  openssl verify -CAfile "$CA" "$cert"

  echo "-- TLS 1.2 --"
  check_live_tls "$target" tls1_2

  echo "-- TLS 1.3 --"
  if ! check_live_tls "$target" tls1_3; then
    if [[ "$REQUIRE_TLS13" == "true" ]]; then
      echo "TLS 1.3 is required but failed for $target." >&2
      exit 1
    fi
    echo "TLS 1.3 is not available/accepted; TLS 1.3 is preferred but not required by this verifier."
  fi
done

echo "TLS certificate-chain and minimum-protocol verification passed for all configured targets."
