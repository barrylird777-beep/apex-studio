#!/usr/bin/env bash
set -Eeuo pipefail
# Read-only path health scorer. Does not alter routing, MPTCP, firewall, or provider policy.
INTERVAL="${INTERVAL:-5}"
ROUNDS="${ROUNDS:-6}"
PROBE_URL="${APEX_PATH_PROBE_URL:-https://www.starlink.com/}"
OUT="${APEX_BACKHAUL_OUT:-.apex-backhaul}"
mkdir -p "$OUT"
command -v ip >/dev/null 2>&1 || { echo "FAIL: iproute2 required"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FAIL: curl required"; exit 1; }

printf 'timestamp,interface,state,default_route,rtt_ms,score\n' > "$OUT/score.csv"

for ((r=1;r<=ROUNDS;r++)); do
  ts="$(date -Is)"
  while read -r iface state mtu; do
    [[ -z "$iface" || "$iface" == "lo" ]] && continue
    route="no"
    ip route show default dev "$iface" 2>/dev/null | grep -q . && route="yes"
    rtt=""
    if ping -I "$iface" -c 1 -W 2 1.1.1.1 >/tmp/apex-ping.$$ 2>/dev/null; then
      rtt="$(awk -F'=' '/time=/{split($2,a," "); print a[1]}' /tmp/apex-ping.$$ | tail -1)"
    fi
    rm -f /tmp/apex-ping.$$
    score=0
    [[ "$state" == "UP" ]] && score=$((score+30))
    [[ "$route" == "yes" ]] && score=$((score+40))
    if [[ -n "$rtt" ]]; then
      if awk "BEGIN{exit !($rtt < 50)}"; then score=$((score+30))
      elif awk "BEGIN{exit !($rtt < 120)}"; then score=$((score+20))
      elif awk "BEGIN{exit !($rtt < 250)}"; then score=$((score+10))
      fi
    fi
    printf '%s,%s,%s,%s,%s,%s\n' "$ts" "$iface" "$state" "$route" "${rtt:-NA}" "$score" | tee -a "$OUT/score.csv"
  done < <(ip -br link)
  ((r<ROUNDS)) && sleep "$INTERVAL"
done

echo "Backhaul scoring complete: $OUT/score.csv"
echo "Scores are observability only; Apex does not silently change routes."
