#!/usr/bin/env bash
set -euo pipefail

CA="${APEX_CA_DIR:-/srv/apex/secrets/ca}/ca.crt"
TARGETS=(
  "${APEX_GIT_TLS_TARGET:-git.apex.internal:443}"
  "${APEX_REGISTRY_TLS_TARGET:-registry.apex.internal:443}"
  "${APEX_WEBHOOK_TLS_TARGET:-webhook.apex.internal:443}"
)

test -r "$CA"

for target in "${TARGETS[@]}"; do
  host="${target%%:*}"
  port="${target##*:}"
  echo "== $target =="
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT

  if ! openssl s_client -connect "$target" -servername "$host" -CAfile "$CA"       -verify_return_error </dev/null >"$tmp" 2>&1; then
    cat "$tmp"
    exit 1
  fi

  grep -E 'Protocol *:|Cipher *:|Verify return code:' "$tmp" || true
  grep -q 'Verify return code: 0 (ok)' "$tmp"
  rm -f "$tmp"
  trap - EXIT
done

echo "TLS certificate-chain verification passed for all configured targets."
echo "Protocol/cipher policy must still be checked against the deployment's TLS configuration."
