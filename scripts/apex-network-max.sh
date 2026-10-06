#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="${APEX_MAX_OUT:-$ROOT/.apex-network-max}"
URL="${APEX_MAX_URL:-https://speed.cloudflare.com/__down?bytes=10000000}"
ROUNDS="${APEX_MAX_ROUNDS:-3}"
TIMEOUT="${APEX_MAX_TIMEOUT:-20}"
mkdir -p "$OUT"
have(){ command -v "$1" >/dev/null 2>&1; }
have ip || { echo "iproute2 required"; exit 1; }
have curl || { echo "curl required"; exit 1; }
mapfile -t DEVS < <(ip -o link show | awk -F': ' '{print $2}' | cut -d'@' -f1 | while read -r d; do [[ "$d" != "lo" && "$(cat "/sys/class/net/$d/operstate" 2>/dev/null || true)" == "up" ]] && echo "$d"; done)
[[ ${#DEVS[@]} -gt 0 ]] || { echo "No active interfaces"; exit 1; }
printf "round,interface,seconds,http_code,bytes,mbps\n" > "$OUT/results.csv"
echo "APEX PARALLEL BACKHAUL MAX BENCHMARK"
echo "Interfaces: ${DEVS[*]}"
for ((r=1;r<=ROUNDS;r++)); do
  start="$(date +%s.%N)"
  pids=()
  for dev in "${DEVS[@]}"; do
    (
      tmp="$OUT/$dev-$r.txt"
      if curl -4 -L --fail --silent --show-error --interface "$dev" --connect-timeout 3 --max-time "$TIMEOUT" -o /dev/null -w "%{time_total},%{http_code},%{size_download}" "$URL" > "$tmp" 2>"$tmp.err"; then
        IFS="," read -r sec code bytes < "$tmp"
        mbps="$(awk -v b="$bytes" -v s="$sec" 'BEGIN{if(s>0) printf "%.2f",(b*8)/(s*1000000); else print "0"}')"
        printf "%s,%s,%s,%s,%s,%s\n" "$r" "$dev" "$sec" "$code" "$bytes" "$mbps" >> "$OUT/results.csv"
        printf "[PATH] round=%s dev=%s mbps=%s code=%s\n" "$r" "$dev" "$mbps" "$code"
      else
        printf "%s,%s,FAILED,000,0,0\n" "$r" "$dev" >> "$OUT/results.csv"
        printf "[PATH] round=%s dev=%s FAILED\n" "$r" "$dev"
      fi
    ) & pids+=("$!")
  done
  for pid in "${pids[@]}"; do wait "$pid" || true; done
  elapsed="$(awk -v a="$start" -v b="$(date +%s.%N)" 'BEGIN{print b-a}')"
  echo "[FABRIC] parallel round $r complete in ${elapsed}s"
done
awk -F, 'NR>1 && $6 ~ /^[0-9]/ {sum+=$6} END{printf "AGGREGATE_OBSERVED_MBPS=%.2f\n",sum}' "$OUT/results.csv" | tee "$OUT/summary.txt"
echo "No routes, firewall rules, MPTCP endpoints, carrier settings, or provider policies were modified."
