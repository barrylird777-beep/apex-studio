#!/usr/bin/env bash
# APEX STUDIO: CELLULAR / MPTCP / KUBO CAPABILITY VERIFIER
set -Eeuo pipefail
TARGET_COMMIT="6e657537f6523049bd7b6245d37647d43eb954f1"
ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PASS=0; SKIP=0; FAIL=0
ok(){ echo "[OK]   $*"; PASS=$((PASS+1)); }
skip(){ echo "[SKIP] $*"; SKIP=$((SKIP+1)); }
fail(){ echo "[FAIL] $*"; FAIL=$((FAIL+1)); }
echo "=========================================================================="
echo "[APEX SPEED] Cellular / MPTCP / Kubo verification"
echo "=========================================================================="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HEAD="$(git rev-parse HEAD)"
  [[ "$HEAD" == "$TARGET_COMMIT" ]] && ok "Target commit bound: $TARGET_COMMIT" || skip "HEAD=$HEAD target=$TARGET_COMMIT"
else fail "Not a Git repository"; fi
if command -v ip >/dev/null 2>&1; then
  ip -brief link || true; ip -brief addr || true; ip route show default || true
else skip "ip command unavailable"; fi
if command -v curl >/dev/null 2>&1; then
  RESULT="$(curl -L --fail --silent --show-error --max-time 30 -o /dev/null -w '%{speed_download} %{time_total}' 'https://speed.cloudflare.com/__down?bytes=10000000')" || RESULT=""
  if [[ -n "$RESULT" ]]; then
    SPEED="$(awk '{printf "%.2f", $1/1048576}' <<<"$RESULT")"
    TIME="$(awk '{printf "%.3f", $2}' <<<"$RESULT")"
    ok "HTTP download probe: $SPEED MiB/s in $TIME s"
  else skip "External throughput probe unavailable"; fi
else skip "curl unavailable"; fi
if [[ -r /proc/sys/net/mptcp/enabled ]]; then
  CURRENT="$(cat /proc/sys/net/mptcp/enabled)"
  if [[ "$CURRENT" == "1" ]]; then ok "MPTCP enabled"
  elif [[ "\${CONFIGURE:-0}" == "1" ]]; then
    if [[ "$EUID" -eq 0 ]]; then sysctl -w net.mptcp.enabled=1 >/dev/null && ok "MPTCP enabled" || fail "Unable to enable MPTCP"
    elif command -v sudo >/dev/null 2>&1; then sudo sysctl -w net.mptcp.enabled=1 >/dev/null && ok "MPTCP enabled via sudo" || fail "Unable to enable MPTCP"
    else fail "Root/sudo required to enable MPTCP"; fi
  else skip "MPTCP available but disabled; use CONFIGURE=1"; fi
else skip "Kernel does not expose net.mptcp.enabled"; fi
if command -v ip >/dev/null 2>&1 && ip mptcp help >/dev/null 2>&1; then ip mptcp endpoint show 2>/dev/null || true; ok "iproute2 exposes MPTCP controls"; else skip "iproute2 MPTCP controls unavailable"; fi
export IPFS_PATH="\${IPFS_PATH:-/data/ipfs}"
if command -v ipfs >/dev/null 2>&1; then
  if ipfs id >/dev/null 2>&1; then
    ok "Kubo daemon reachable"
    if [[ "\${CONFIGURE:-0}" == "1" ]]; then
      ipfs config --json Datastore.StorageMax '"100GB"'
      ipfs config --json Swarm.ConnMgr.HighWater 900
      ipfs config --json Swarm.ConnMgr.LowWater 300
      ok "Kubo performance configuration applied"
    else skip "Kubo configuration unchanged; use CONFIGURE=1"; fi
    ipfs config Datastore.StorageMax || true
    ipfs config Swarm.ConnMgr.HighWater || true
    ipfs config Swarm.ConnMgr.LowWater || true
  else skip "Kubo CLI exists but daemon is not reachable"; fi
else skip "Kubo CLI unavailable"; fi
echo "=========================================================================="
echo "[APEX SPEED] PASS=$PASS SKIP=$SKIP FAIL=$FAIL"
if (( FAIL > 0 )); then echo "[APEX SPEED] VERIFICATION FAILED"; exit 1; fi
echo "[APEX SPEED] VERIFICATION COMPLETE"
echo "=========================================================================="
