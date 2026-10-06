#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="${APEX_FABRIC_OUT:-$ROOT/.apex-fabric-controller}"
INTERVAL="${APEX_FABRIC_INTERVAL:-1}"
PROBE="${APEX_FABRIC_PROBE_URL:-https://www.starlink.com/}"
TIMEOUT="${APEX_FABRIC_PROBE_TIMEOUT:-5}"
mkdir -p "$OUT"
have(){ command -v "$1" >/dev/null 2>&1; }
now(){ date -Is; }
score_path(){ local rtt="${1:-999}" code="${2:-0}"; if [[ "$code" =~ ^2|^3 ]]; then awk -v r="$rtt" 'BEGIN{s=100-(r*20); if(s<0)s=0; printf "%.2f",s}'; else printf "0.00"; fi; }
echo "APEX ACTIVE BACKHAUL FABRIC CONTROLLER"
echo "Mode: observe + score + select; no silent route changes"
printf 'timestamp,interface,state,ipv4,route,rtt_seconds,http_code,score\n' > "$OUT/path-state.csv"
while :; do
  ts="$(now)"; best_dev=""; best_score="0"
  have ip || { echo "ERROR: iproute2 unavailable" >&2; exit 1; }
  while read -r dev; do
    [[ -z "$dev" || "$dev" == "lo" ]] && continue
    state="$(cat "/sys/class/net/$dev/operstate" 2>/dev/null || echo unknown)"
    [[ "$state" == "up" ]] || continue
    addr="$(ip -o -4 addr show dev "$dev" 2>/dev/null | awk '{print $4}' | paste -sd'|' - || true)"
    route="$(ip route show default dev "$dev" 2>/dev/null | head -1 | tr ',' ';' || true)"
    rtt="999"; code="000"
    if have curl && curl -4 -L --silent --show-error --fail --interface "$dev" --connect-timeout 2 --max-time "$TIMEOUT" -o /dev/null -w '%{time_total},%{http_code}' "$PROBE" > "$OUT/.probe" 2>/dev/null; then
      IFS=',' read -r rtt code < "$OUT/.probe"
    fi
    score="$(score_path "$rtt" "$code")"
    printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$ts" "$dev" "$state" "$addr" "$route" "$rtt" "$code" "$score" >> "$OUT/path-state.csv"
    if awk -v a="$score" -v b="$best_score" 'BEGIN{exit !(a>b)}'; then best_score="$score"; best_dev="$dev"; fi
  done < <(ip -o link show | awk -F': ' '{print $2}' | cut -d'@' -f1)
  { echo "timestamp=$ts"; echo "selected_interface=$best_dev"; echo "selected_score=$best_score"; echo "selection_policy=best_healthy_observed_path"; echo "route_mutation=disabled"; echo "mptcp=$(cat /proc/sys/net/mptcp/enabled 2>/dev/null || echo unavailable)"; echo "batman=$(have batctl && echo available || echo unavailable)"; echo "kubo=$(have ipfs && echo available || echo unavailable)"; } > "$OUT/current-selection.env"
  printf '[FABRIC] %s selected=%s score=%s\n' "$ts" "${best_dev:-none}" "$best_score"
  sleep "$INTERVAL"
done
