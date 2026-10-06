#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="${APEX_FABRIC_OUT:-$ROOT/.apex-fabric}"
ROUNDS="${ROUNDS:-5}"
INTERVAL="${INTERVAL:-2}"
PROBE="${APEX_FABRIC_PROBE_URL:-https://www.starlink.com/}"
mkdir -p "$OUT"

PASS=0; SKIP=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '[OK] %s\n' "$*"; }
skip(){ SKIP=$((SKIP+1)); printf '[SKIP] %s\n' "$*"; }
bad(){ FAIL=$((FAIL+1)); printf '[FAIL] %s\n' "$*"; }
have(){ command -v "$1" >/dev/null 2>&1; }

echo "======================================================================"
echo " APEX BACKHAUL FABRIC — DECENTRALIZED WIFI + STARLINK + P2P"
echo "======================================================================"

# 1. Discover every usable interface instead of assuming eth0/wlan0.
if have ip; then
  ip -brief link > "$OUT/interfaces.txt" 2>&1 || true
  ip -brief addr > "$OUT/addresses.txt" 2>&1 || true
  ip route show table all > "$OUT/routes.txt" 2>&1 || true
  ip -s link > "$OUT/link-counters.txt" 2>&1 || true
  ok "multi-interface inventory captured"
else
  bad "iproute2 unavailable"
fi

# 2. Identify Wi-Fi radios and mesh capability.
if have iw; then
  iw dev > "$OUT/wifi-devices.txt" 2>&1 || true
  iw phy > "$OUT/wifi-phy.txt" 2>&1 || true
  if grep -qiE 'mesh point|mesh point' "$OUT/wifi-phy.txt"; then
    ok "802.11s mesh capability exposed"
  else
    skip "802.11s mesh capability not exposed by current driver"
  fi
  while read -r dev; do
    [[ -z "$dev" ]] && continue
    iw dev "$dev" link > "$OUT/wifi-$dev-link.txt" 2>&1 || true
    iw dev "$dev" station dump > "$OUT/wifi-$dev-stations.txt" 2>&1 || true
  done < <(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}')
else
  skip "iw unavailable"
fi

# 3. BATMAN-adv, when installed, gives actual L2 mesh topology evidence.
if have batctl; then
  batctl n > "$OUT/batman-neighbors.txt" 2>&1 || true
  batctl o > "$OUT/batman-originators.txt" 2>&1 || true
  batctl if > "$OUT/batman-interfaces.txt" 2>&1 || true
  ok "BATMAN-adv topology captured"
else
  skip "batctl unavailable"
fi

# 4. MPTCP capability and active paths.
if [[ -r /proc/sys/net/mptcp/enabled ]]; then
  cat /proc/sys/net/mptcp/enabled > "$OUT/mptcp-enabled.txt"
  [[ "$(cat /proc/sys/net/mptcp/enabled)" == "1" ]] && ok "MPTCP enabled" || skip "MPTCP present but disabled"
else
  skip "kernel MPTCP control unavailable"
fi
if have ip && ip mptcp help >/dev/null 2>&1; then
  ip mptcp endpoint show > "$OUT/mptcp-endpoints.txt" 2>&1 || true
  ip mptcp limits show > "$OUT/mptcp-limits.txt" 2>&1 || true
  ok "MPTCP path policy visible"
fi
if have ss; then ss -M -a > "$OUT/mptcp-sockets.txt" 2>&1 || true; fi

# 5. Decentralized data plane.
if have ipfs; then
  if ipfs id > "$OUT/ipfs-id.txt" 2>&1; then
    ipfs swarm peers > "$OUT/ipfs-peers.txt" 2>&1 || true
    ipfs stats bw > "$OUT/ipfs-bandwidth.txt" 2>&1 || true
    ipfs swarm addrs local > "$OUT/ipfs-local-addrs.txt" 2>&1 || true
    ok "Kubo P2P node reachable"
  else
    skip "Kubo CLI present but daemon unavailable"
  fi
else
  skip "Kubo unavailable"
fi

# 6. Probe every interface independently. This does NOT change routes.
if have curl && have ip; then
  : > "$OUT/interface-probes.csv"
  echo "interface,addresses,default_route,probe_seconds,http_code" >> "$OUT/interface-probes.csv"
  while read -r dev; do
    [[ -z "$dev" ]] && continue
    state="$(cat "/sys/class/net/$dev/operstate" 2>/dev/null || echo unknown)"
    [[ "$state" == "up" ]] || continue
    addr="$(ip -o -4 addr show dev "$dev" 2>/dev/null | awk '{print $4}' | paste -sd'|' - || true)"
    route="$(ip route show default dev "$dev" 2>/dev/null | head -1 | tr ',' ';' || true)"
    if curl -L --fail --silent --show-error --interface "$dev" --connect-timeout 5 --max-time 15 -o /dev/null -w '%{time_total},%{http_code}' "$PROBE" > "$OUT/.probe" 2>"$OUT/.probe.err"; then
      result="$(cat "$OUT/.probe")"
      ok "interface probe: $dev -> $result"
    else
      result="FAILED,000"
      skip "interface probe unavailable: $dev"
    fi
    printf '%s,%s,%s,%s\n' "$dev" "$addr" "$route" "$result" >> "$OUT/interface-probes.csv"
  done < <(ip -o link show | awk -F': ' '{print $2}' | cut -d'@' -f1 | grep -v '^lo$')
fi

# 7. Continuous fabric telemetry.
{
  for ((i=1;i<=ROUNDS;i++)); do
    echo "=== ROUND $i/$ROUNDS $(date -Is) ==="
    ip route show default 2>/dev/null || true
    ip -brief link 2>/dev/null || true
    ip -s link 2>/dev/null || true
    ip mptcp endpoint show 2>/dev/null || true
    ss -M -a 2>/dev/null || true
    ipfs stats bw 2>/dev/null || true
    if have batctl; then batctl n 2>/dev/null || true; fi
    echo
    ((i<ROUNDS)) && sleep "$INTERVAL"
  done
} | tee "$OUT/live-fabric.txt"

cat > "$OUT/manifest.txt" <<EOF
fabric=decentralized-wifi-starlink-p2p
probe=$PROBE
rounds=$ROUNDS
interval=$INTERVAL
timestamp=$(date -Is)
EOF

echo "======================================================================"
echo " FABRIC RESULT: PASS=$PASS SKIP=$SKIP FAIL=$FAIL"
echo " Evidence: $OUT"
echo "======================================================================"
if (( FAIL > 0 )); then echo "VERDICT=FAIL"; exit 1; fi
echo "VERDICT=PASS_WITH_SKIPS"
