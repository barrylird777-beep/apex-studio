#!/usr/bin/env bash
# APEX STUDIO: MPTCP MULTIPATH OBSERVER
# Measures and verifies legitimate multipath transport; never attempts carrier-policy evasion.
set -Eeuo pipefail
INTERVAL="\${INTERVAL:-2}"
ROUNDS="\${ROUNDS:-3}"
fail(){ echo "[FAIL] $*" >&2; exit 1; }
command -v ip >/dev/null 2>&1 || fail "iproute2 is required"
echo "=== APEX MPTCP MULTIPATH OBSERVER ==="
echo "[*] Kernel:"
uname -r
if [[ -r /proc/sys/net/mptcp/enabled ]]; then
  echo "[*] net.mptcp.enabled=$(cat /proc/sys/net/mptcp/enabled)"
else
  echo "[FAIL] Kernel MPTCP interface unavailable"
  exit 1
fi
echo "[*] Interfaces:"
ip -brief link || true
echo "[*] Addresses:"
ip -brief addr || true
echo "[*] Routes:"
ip route show || true
echo "[*] MPTCP endpoints:"
ip mptcp endpoint show 2>/dev/null || echo "(unavailable)"
echo "[*] MPTCP limits:"
ip mptcp limits show 2>/dev/null || echo "(unavailable)"
if command -v ss >/dev/null 2>&1; then
  echo "[*] Existing MPTCP sockets:"
  ss -M -a 2>/dev/null || true
fi
echo "[*] Sampling path state..."
for ((i=1;i<=ROUNDS;i++)); do
  echo "--- sample $i/$ROUNDS ---"
  ip -s link
  if command -v ss >/dev/null 2>&1; then ss -M -a 2>/dev/null || true; fi
  (( i < ROUNDS )) && sleep "$INTERVAL"
done
echo "=== OBSERVATION COMPLETE ==="
