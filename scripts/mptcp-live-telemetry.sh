#!/usr/bin/env bash
set -Eeuo pipefail
INTERVAL="${INTERVAL:-1}"
ROUNDS="${ROUNDS:-30}"
OUT="${APEX_MPTCP_OUT:-.apex-mptcp}"
mkdir -p "$OUT"
command -v ip >/dev/null 2>&1 || { echo "[FAIL] iproute2 required"; exit 1; }
echo "======================================================================"
echo " APEX STUDIO — LIVE MPTCP PATH SCOREBOARD"
echo "======================================================================"
echo "rounds=$ROUNDS interval=${INTERVAL:-1}s"
echo "timestamp,interface,rx_bytes,tx_bytes"
for ((round=1; round<=ROUNDS; round++)); do
  ts="$(date -Is)"
  ip -brief addr > "$OUT/live-$round.addr" 2>&1 || true
  ip route show table all > "$OUT/live-$round.routes" 2>&1 || true
  ip -s link > "$OUT/live-$round.links" 2>&1 || true
  ip mptcp endpoint show > "$OUT/live-$round.mptcp.endpoints" 2>&1 || true
  ip mptcp limits show > "$OUT/live-$round.mptcp.limits" 2>&1 || true
  if command -v ss >/dev/null 2>&1; then ss -M -a > "$OUT/live-$round.sockets" 2>&1 || true; fi
  echo "--- round $round/$ROUNDS $ts ---"
  echo "[interfaces]"; cat "$OUT/live-$round.addr" || true
  echo "[routes]"; cat "$OUT/live-$round.routes" || true
  echo "[mptcp endpoints]"; cat "$OUT/live-$round.mptcp.endpoints" || true
  echo "[mptcp limits]"; cat "$OUT/live-$round.mptcp.limits" || true
  echo "[mptcp sockets]"; cat "$OUT/live-$round.sockets" 2>/dev/null || true
  (( round < ROUNDS )) && sleep "$INTERVAL"
done
echo "======================================================================"
echo "LIVE TELEMETRY COMPLETE"
echo "Evidence: $OUT"
echo "======================================================================"
