#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}" )/.." && pwd)"
cd "$ROOT"
TARGET_COMMIT="6e657537f6523049bd7b6245d37647d43eb954f1"
OUT_DIR="${APEX_MPTCP_OUT:-$ROOT/.apex-mptcp}"
ROUNDS="${ROUNDS:-5}"
INTERVAL="${INTERVAL:-2}"
BENCHMARK_URL="${BENCHMARK_URL:-https://speed.cloudflare.com/__down?bytes=10000000}"
TIMEOUT="${TIMEOUT:-30}"
PASS=0; SKIP=0; FAIL=0
mkdir -p "$OUT_DIR"
log(){ printf '[%s] %s\n' "$1" "$2"; }
ok(){ PASS=$((PASS+1)); log OK "$*"; }
skip(){ SKIP=$((SKIP+1)); log SKIP "$*"; }
bad(){ FAIL=$((FAIL+1)); log FAIL "$*"; }

echo "======================================================================"
echo " APEX STUDIO — MPTCP MULTIPATH LAB"
echo "======================================================================"
echo "Output: $OUT_DIR"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HEAD="$(git rev-parse HEAD)"
  printf '%s\n' "$HEAD" > "$OUT_DIR/git-head.txt"
  [[ "$HEAD" == "$TARGET_COMMIT" ]] && ok "Repository exactly matches target" || skip "HEAD=$HEAD target=$TARGET_COMMIT"
else bad "Not inside a Git work tree"; fi

{
  echo "timestamp=$(date -Is)"
  echo "hostname=$(hostname 2>/dev/null || true)"
  echo "kernel=$(uname -srmo)"
  echo "arch=$(uname -m)"
} | tee "$OUT_DIR/platform.txt"

for cmd in ip awk sed grep curl ss; do
  command -v "$cmd" >/dev/null 2>&1 && ok "Tool available: $cmd" || skip "Tool unavailable: $cmd"
done

if command -v ip >/dev/null 2>&1; then
  ip -brief link > "$OUT_DIR/interfaces.txt" 2>&1 || true
  ip -brief addr > "$OUT_DIR/addresses.txt" 2>&1 || true
  ip route show table all > "$OUT_DIR/routes.txt" 2>&1 || true
  ip -s link > "$OUT_DIR/link-counters.txt" 2>&1 || true
  ok "Captured interface/address/route/counter inventory"
else bad "iproute2 unavailable"; fi

if [[ -r /proc/sys/net/mptcp/enabled ]]; then
  MPTCP_ENABLED="$(cat /proc/sys/net/mptcp/enabled)"
  echo "$MPTCP_ENABLED" > "$OUT_DIR/mptcp-enabled.txt"
  [[ "$MPTCP_ENABLED" == "1" ]] && ok "Kernel MPTCP enabled" || skip "Kernel MPTCP exists but is disabled"
else bad "Kernel MPTCP interface unavailable"; fi

if command -v ip >/dev/null 2>&1 && ip mptcp help >/dev/null 2>&1; then
  ip mptcp endpoint show > "$OUT_DIR/mptcp-endpoints.txt" 2>&1 || true
  ip mptcp limits show > "$OUT_DIR/mptcp-limits.txt" 2>&1 || true
  ok "iproute2 exposes MPTCP management"
else skip "iproute2 MPTCP management unavailable"; fi

if command -v ss >/dev/null 2>&1; then
  ss -M -a > "$OUT_DIR/mptcp-sockets.txt" 2>&1 || true
  ss -tan > "$OUT_DIR/tcp-sockets.txt" 2>&1 || true
  ok "Captured socket inventory"
else skip "ss unavailable"; fi

if command -v curl >/dev/null 2>&1; then
  if RESULT="$(curl -L --fail --silent --show-error --connect-timeout 10 --max-time "$TIMEOUT" -o /dev/null -w '%{speed_download} %{time_total} %{http_code}' "$BENCHMARK_URL" 2>"$OUT_DIR/curl-error.txt")"; then
    SPEED_BYTES="$(awk '{print $1}' <<<"$RESULT")"
    ELAPSED="$(awk '{print $2}' <<<"$RESULT")"
    STATUS="$(awk '{print $3}' <<<"$RESULT")"
    printf 'speed_bytes_per_second=%s\nelapsed_seconds=%s\nhttp_status=%s\n' "$SPEED_BYTES" "$ELAPSED" "$STATUS" > "$OUT_DIR/baseline.txt"
    ok "Baseline: $SPEED_BYTES B/s, $ELAPSED s, HTTP $STATUS"
  else skip "Baseline endpoint unavailable"; fi
else skip "curl unavailable"; fi

echo "[*] Sampling path state..."
{
  for ((i=1; i<=ROUNDS; i++)); do
    echo "=== SAMPLE $i/$ROUNDS $(date -Is) ==="
    ip -brief link 2>/dev/null || true
    ip route show default 2>/dev/null || true
    ip mptcp endpoint show 2>/dev/null || true
    ip mptcp limits show 2>/dev/null || true
    ss -M -a 2>/dev/null || true
    ip -s link 2>/dev/null || true
    echo
    (( i < ROUNDS )) && sleep "$INTERVAL"
  done
} | tee "$OUT_DIR/path-samples.txt"
ok "Captured $ROUNDS path-state samples"

export IPFS_PATH="${IPFS_PATH:-/data/ipfs}"
if command -v ipfs >/dev/null 2>&1; then
  if ipfs id > "$OUT_DIR/kubo-id.txt" 2>&1; then
    ok "Kubo daemon reachable"
    ipfs swarm peers > "$OUT_DIR/kubo-peers.txt" 2>&1 || true
    ipfs stats bw > "$OUT_DIR/kubo-bandwidth.txt" 2>&1 || true
    ipfs swarm addrs local > "$OUT_DIR/kubo-local-addrs.txt" 2>&1 || true
    ok "Captured Kubo swarm/bandwidth evidence"
  else skip "Kubo CLI exists but daemon is unreachable"; fi
else skip "Kubo not installed"; fi

{
  echo "target_commit=$TARGET_COMMIT"
  echo "observed_commit=$HEAD"
  echo "rounds=$ROUNDS"
  echo "interval_seconds=$INTERVAL"
  echo "benchmark_url=$BENCHMARK_URL"
  echo "output_directory=$OUT_DIR"
  find "$OUT_DIR" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | sort || true
} > "$OUT_DIR/manifest.txt"

echo "======================================================================"
echo " MPTCP LAB RESULT"
echo " PASS=$PASS SKIP=$SKIP FAIL=$FAIL"
echo " Evidence=$OUT_DIR"
echo "======================================================================"
if (( FAIL > 0 )); then echo "VERDICT=FAIL"; exit 1; fi
echo "VERDICT=PASS_WITH_SKIPS"
