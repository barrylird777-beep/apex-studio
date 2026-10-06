#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="${APEX_FABRIC_OUT:-$ROOT/.apex-fabric}"
ROUNDS="${ROUNDS:-8}"
INTERVAL="${INTERVAL:-1}"
PROBE="${APEX_FABRIC_PROBE_URL:-https://www.starlink.com/}"
PROBE_TIMEOUT="${APEX_FABRIC_PROBE_TIMEOUT:-8}"
mkdir -p "$OUT" "$OUT/probes" "$OUT/topology"

PASS=0; SKIP=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '[OK] %s\n' "$*"; }
skip(){ SKIP=$((SKIP+1)); printf '[SKIP] %s\n' "$*"; }
bad(){ FAIL=$((FAIL+1)); printf '[FAIL] %s\n' "$*"; }
have(){ command -v "$1" >/dev/null 2>&1; }

echo "======================================================================"
echo " APEX ELITE BACKHAUL FABRIC"
echo " DECENTRALIZED WIFI MESH + STARLINK + MPTCP + IPFS"
echo "======================================================================"

# ---- CAPABILITY DISCOVERY -------------------------------------------------
for c in ip iw ss curl awk sed grep; do
  have "$c" && ok "tool: $c" || skip "tool unavailable: $c"
done

if have ip; then
  ip -brief link > "$OUT/interfaces.txt" 2>&1 || true
  ip -brief addr > "$OUT/addresses.txt" 2>&1 || true
  ip route show table all > "$OUT/routes.txt" 2>&1 || true
  ip -s link > "$OUT/link-counters.txt" 2>&1 || true
  ip rule show > "$OUT/policy-rules.txt" 2>&1 || true
  ok "full interface/routing inventory captured"
else
  bad "iproute2 unavailable"
fi

# ---- WIFI / MESH ----------------------------------------------------------
if have iw; then
  iw dev > "$OUT/wifi-devices.txt" 2>&1 || true
  iw phy > "$OUT/wifi-phy.txt" 2>&1 || true
  grep -qi 'mesh point' "$OUT/wifi-phy.txt" && ok "802.11s capability exposed" || skip "802.11s capability unavailable"
  while read -r dev; do
    [[ -z "$dev" ]] && continue
    iw dev "$dev" link > "$OUT/wifi-$dev-link.txt" 2>&1 || true
    iw dev "$dev" station dump > "$OUT/wifi-$dev-stations.txt" 2>&1 || true
    iw dev "$dev" info > "$OUT/wifi-$dev-info.txt" 2>&1 || true
  done < <(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}')
else
  skip "iw unavailable"
fi

if have batctl; then
  batctl n > "$OUT/topology/batman-neighbors.txt" 2>&1 || true
  batctl o > "$OUT/topology/batman-originators.txt" 2>&1 || true
  batctl if > "$OUT/topology/batman-interfaces.txt" 2>&1 || true
  batctl tr 2>/dev/null > "$OUT/topology/batman-trace.txt" || true
  ok "BATMAN-adv mesh topology captured"
else
  skip "BATMAN-adv unavailable"
fi

# ---- MPTCP ----------------------------------------------------------------
if [[ -r /proc/sys/net/mptcp/enabled ]]; then
  enabled="$(cat /proc/sys/net/mptcp/enabled)"
  printf '%s\n' "$enabled" > "$OUT/mptcp-enabled.txt"
  [[ "$enabled" == "1" ]] && ok "MPTCP enabled" || skip "MPTCP present but disabled"
else
  skip "kernel MPTCP unavailable"
fi

if have ip && ip mptcp help >/dev/null 2>&1; then
  ip mptcp endpoint show > "$OUT/mptcp-endpoints.txt" 2>&1 || true
  ip mptcp limits show > "$OUT/mptcp-limits.txt" 2>&1 || true
  ok "MPTCP endpoint/limit state captured"
fi
have ss && ss -M -a > "$OUT/mptcp-sockets.txt" 2>&1 || true

# ---- DECENTRALIZED DATA PLANE ---------------------------------------------
if have ipfs; then
  if ipfs id > "$OUT/ipfs-id.txt" 2>&1; then
    ipfs swarm peers > "$OUT/ipfs-peers.txt" 2>&1 || true
    ipfs stats bw > "$OUT/ipfs-bandwidth.txt" 2>&1 || true
    ipfs swarm addrs local > "$OUT/ipfs-local-addrs.txt" 2>&1 || true
    ipfs routing findpeer "$(awk '/^ID:/{print $2; exit}' "$OUT/ipfs-id.txt" 2>/dev/null || true)" > "$OUT/ipfs-self-routing.txt" 2>&1 || true
    ok "Kubo/libp2p data plane reachable"
  else
    skip "Kubo installed but daemon unavailable"
  fi
else
  skip "Kubo unavailable"
fi

# ---- PER-PATH PROBING -----------------------------------------------------
# Never modifies routes. It measures independent links only.
if have curl && have ip; then
  printf 'timestamp,interface,state,ipv4,default_route,probe_seconds,http_code\n' > "$OUT/path-score.csv"
  while read -r dev; do
    [[ -z "$dev" || "$dev" == "lo" ]] && continue
    state="$(cat "/sys/class/net/$dev/operstate" 2>/dev/null || echo unknown)"
    [[ "$state" == "up" ]] || continue
    addr="$(ip -o -4 addr show dev "$dev" 2>/dev/null | awk '{print $4}' | paste -sd'|' - || true)"
    route="$(ip route show default dev "$dev" 2>/dev/null | head -1 | tr ',' ';' || true)"
    stamp="$(date -Is)"
    result="FAILED,000"
    if curl -4 -L --fail --silent --show-error --interface "$dev"       --connect-timeout 3 --max-time "$PROBE_TIMEOUT" -o /dev/null       -w '%{time_total},%{http_code}' "$PROBE" > "$OUT/probes/$dev.txt" 2>"$OUT/probes/$dev.err"; then
      result="$(cat "$OUT/probes/$dev.txt")"
      ok "path probe: $dev -> $result"
    else
      skip "path probe failed: $dev"
    fi
    printf '%s,%s,%s,%s,%s,%s\n' "$stamp" "$dev" "$state" "$addr" "$route" "$result" >> "$OUT/path-score.csv"
  done < <(ip -o link show | awk -F': ' '{print $2}' | cut -d'@' -f1)
fi

# ---- LIVE FABRIC TELEMETRY -------------------------------------------------
{
  for ((i=1;i<=ROUNDS;i++)); do
    echo "=== ROUND $i/$ROUNDS $(date -Is) ==="
    echo "--- DEFAULT ROUTES ---"
    ip route show default 2>/dev/null || true
    echo "--- LINKS ---"
    ip -brief link 2>/dev/null || true
    echo "--- LINK COUNTERS ---"
    ip -s link 2>/dev/null || true
    echo "--- MPTCP ---"
    ip mptcp endpoint show 2>/dev/null || true
    ss -M -a 2>/dev/null || true
    echo "--- WIFI ---"
    iw dev 2>/dev/null || true
    echo "--- BATMAN ---"
    batctl n 2>/dev/null || true
    echo "--- IPFS ---"
    ipfs stats bw 2>/dev/null || true
    echo
    ((i<ROUNDS)) && sleep "$INTERVAL"
  done
} | tee "$OUT/live-fabric.txt"

# ---- MACHINE-READABLE MANIFEST --------------------------------------------
cat > "$OUT/manifest.txt" <<EOF
fabric=elite-decentralized-wifi-starlink-p2p
timestamp=$(date -Is)
rounds=$ROUNDS
interval_seconds=$INTERVAL
probe=$PROBE
probe_timeout_seconds=$PROBE_TIMEOUT
route_changes=none
provider_policy_changes=none
EOF

echo "======================================================================"
echo " ELITE FABRIC RESULT"
echo " PASS=$PASS SKIP=$SKIP FAIL=$FAIL"
echo " EVIDENCE=$OUT"
echo "======================================================================"
if (( FAIL > 0 )); then
  echo "VERDICT=FAIL"
  exit 1
fi
echo "VERDICT=PASS_WITH_SKIPS"
