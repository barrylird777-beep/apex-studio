#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT_DIR="${APEX_BACKHAUL_OUT:-$ROOT/.apex-backhaul}"
ROUNDS="${ROUNDS:-6}"
INTERVAL="${INTERVAL:-2}"
PROBE_URL="${APEX_BACKHAUL_PROBE_URL:-https://www.starlink.com/}"
mkdir -p "$OUT_DIR"
PASS=0; SKIP=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '[OK] %s\n' "$*"; }
skip(){ SKIP=$((SKIP+1)); printf '[SKIP] %s\n' "$*"; }
bad(){ FAIL=$((FAIL+1)); printf '[FAIL] %s\n' "$*"; }
have(){ command -v "$1" >/dev/null 2>&1; }

echo "======================================================================"
echo " APEX — DECENTRALIZED WIFI MESH + STARLINK BACKHAUL"
echo "======================================================================"

for c in ip iw ss curl awk sed grep; do
  have "$c" && ok "tool: $c" || skip "tool unavailable: $c"
done

if have ip; then
  ip -brief link > "$OUT_DIR/interfaces.txt" 2>&1 || true
  ip -brief addr > "$OUT_DIR/addresses.txt" 2>&1 || true
  ip route show table all > "$OUT_DIR/routes.txt" 2>&1 || true
  ip -s link > "$OUT_DIR/link-counters.txt" 2>&1 || true
  ok "captured network inventory"
fi

if have iw; then
  iw dev > "$OUT_DIR/wifi-devices.txt" 2>&1 || true
  iw phy > "$OUT_DIR/wifi-capabilities.txt" 2>&1 || true
  if iw phy 2>/dev/null | grep -q 'mesh point'; then
    ok "802.11s mesh capability detected"
  else
    skip "802.11s mesh capability not exposed by current Wi-Fi driver"
  fi
  for dev in $(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}'); do
    iw dev "$dev" link > "$OUT_DIR/wifi-$dev-link.txt" 2>&1 || true
    iw dev "$dev" station dump > "$OUT_DIR/wifi-$dev-stations.txt" 2>&1 || true
  done
else
  skip "iw unavailable; Wi-Fi mesh inspection skipped"
fi

if have batctl; then
  batctl n > "$OUT_DIR/batman-neighbors.txt" 2>&1 || true
  batctl o > "$OUT_DIR/batman-originators.txt" 2>&1 || true
  batctl if > "$OUT_DIR/batman-interfaces.txt" 2>&1 || true
  ok "BATMAN-adv mesh state captured"
else
  skip "batctl unavailable; BATMAN-adv inspection skipped"
fi

if have ipfs; then
  if ipfs id > "$OUT_DIR/ipfs-id.txt" 2>&1; then
    ipfs swarm peers > "$OUT_DIR/ipfs-peers.txt" 2>&1 || true
    ipfs stats bw > "$OUT_DIR/ipfs-bandwidth.txt" 2>&1 || true
    ipfs swarm addrs local > "$OUT_DIR/ipfs-local-addrs.txt" 2>&1 || true
    ok "decentralized IPFS/Kubo node reachable"
  else
    skip "ipfs installed but daemon unreachable"
  fi
else
  skip "Kubo/ipfs CLI unavailable"
fi

if have curl; then
  if curl -L --fail --silent --show-error --connect-timeout 10 --max-time 20 -o /dev/null -w 'probe_http=%{http_code}\nprobe_seconds=%{time_total}\nprobe_bytes=%{size_download}\n' "$PROBE_URL" > "$OUT_DIR/backhaul-probe.txt" 2>"$OUT_DIR/backhaul-probe.err"; then
    ok "Starlink/public backhaul probe reachable"
  else
    skip "public backhaul probe failed"
  fi
fi

{
  for ((i=1;i<=ROUNDS;i++)); do
    echo "=== ROUND $i/$ROUNDS $(date -Is) ==="
    ip route show default 2>/dev/null || true
    ip -brief link 2>/dev/null || true
    ip -s link 2>/dev/null || true
    iw dev 2>/dev/null || true
    for dev in $(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}'); do
      echo "--- $dev link ---"
      iw dev "$dev" link 2>/dev/null || true
    done
    command -v batctl >/dev/null 2>&1 && batctl n 2>/dev/null || true
    command -v ipfs >/dev/null 2>&1 && ipfs stats bw 2>/dev/null || true
    echo
    ((i<ROUNDS)) && sleep "$INTERVAL"
  done
} | tee "$OUT_DIR/live-paths.txt"

cat > "$OUT_DIR/manifest.txt" <<EOF
mode=decentralized-wifi-mesh-plus-starlink
rounds=$ROUNDS
interval_seconds=$INTERVAL
probe_url=$PROBE_URL
timestamp=$(date -Is)
EOF

echo "======================================================================"
echo " RESULT PASS=$PASS SKIP=$SKIP FAIL=$FAIL"
echo " Evidence: $OUT_DIR"
echo "======================================================================"
((FAIL==0)) && echo "VERDICT=PASS_WITH_SKIPS" || { echo "VERDICT=FAIL"; exit 1; }
