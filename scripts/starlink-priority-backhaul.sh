#!/usr/bin/env bash
set -euo pipefail

# Apex Studio — Starlink / Priority Backhaul Capability Verifier
# Safe by default: observes connectivity and routing; never changes routes,
# MPTCP policy, firewall state, or provider configuration.

PASS=0; SKIP=0; FAIL=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_COMMIT="${APEX_TARGET_COMMIT:-6e657537f6523049bd7b6245d37647d43eb954f1}"

pass(){ PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
skip(){ SKIP=$((SKIP+1)); printf 'SKIP  %s\n' "$1"; }
fail(){ FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "$1"; }

cd "$ROOT"
actual="$(git rev-parse HEAD 2>/dev/null || true)"
[[ "$actual" == "$TARGET_COMMIT" ]] && pass "target commit $TARGET_COMMIT" || skip "commit is $actual (expected $TARGET_COMMIT)"

command -v ip >/dev/null 2>&1 || { fail "iproute2 is required"; exit 1; }
command -v curl >/dev/null 2>&1 || { fail "curl is required"; exit 1; }

printf '\n== Interfaces ==\n'
ip -br link || true
printf '\n== Addresses ==\n'
ip -br addr || true
printf '\n== Default routes ==\n'
ip -4 route show default || true
ip -6 route show default || true

printf '\n== Candidate backhaul links ==\n'
found=0
while read -r name state mtu; do
  [[ -z "$name" || "$name" == "lo" ]] && continue
  found=1
  printf '%-16s state=%-10s mtu=%s\n' "$name" "$state" "$mtu"
done < <(ip -br link 2>/dev/null || true)
(( found )) && pass "network interfaces discovered" || skip "no non-loopback interfaces discovered"

printf '\n== Route ownership ==\n'
if ip -4 route get 1.1.1.1 >/tmp/apex-route.$$ 2>/dev/null; then
  cat /tmp/apex-route.$$
  pass "IPv4 egress route is available"
else
  skip "IPv4 egress route unavailable"
fi
rm -f /tmp/apex-route.$$

printf '\n== Internet reachability ==\n'
if curl -fsS --max-time 10 -o /dev/null https://www.starlink.com/; then
  pass "HTTPS reachability"
else
  fail "HTTPS reachability"
fi

printf '\n== Starlink detection ==\n'
starlink_hint=0
for iface in $(ip -br link | awk '{print $1}' | grep -Ev '^lo$' || true); do
  if [[ "$iface" =~ starlink|dish ]]; then
    printf 'candidate interface: %s\n' "$iface"
    starlink_hint=1
  fi
done
if (( starlink_hint )); then
  pass "Starlink-named interface detected"
else
  skip "no Starlink-named interface; Starlink may be behind a router or have a generic interface name"
fi

printf '\n== Public-address evidence ==\n'
public_ip="$(curl -4fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
if [[ -n "$public_ip" ]]; then
  printf 'observed IPv4: %s\n' "$public_ip"
  pass "public IPv4 observed"
else
  skip "public IPv4 unavailable"
fi

printf '\n== MPTCP capability ==\n'
if [[ -r /proc/sys/net/mptcp/enabled ]]; then
  printf 'enabled=%s\n' "$(cat /proc/sys/net/mptcp/enabled)"
  command -v ip >/dev/null 2>&1 && ip mptcp endpoint show 2>/dev/null || true
  pass "kernel exposes MPTCP controls"
else
  skip "kernel does not expose /proc/sys/net/mptcp/enabled"
fi

printf '\n== Kubo correlation ==\n'
if curl -fsS --max-time 3 http://127.0.0.1:5001/api/v0/id >/tmp/apex-kubo.$$.json 2>/dev/null; then
  pass "Kubo API reachable on 127.0.0.1:5001"
  if command -v jq >/dev/null 2>&1; then jq '{ID,AgentVersion}' /tmp/apex-kubo.$$.json || true; else cat /tmp/apex-kubo.$$.json; fi
else
  skip "Kubo API not reachable on 127.0.0.1:5001"
fi
rm -f /tmp/apex-kubo.$$

printf '\n== Result ==\n'
printf 'PASS=%s SKIP=%s FAIL=%s\n' "$PASS" "$SKIP" "$FAIL"
(( FAIL == 0 )) || exit 1
printf 'Starlink/Priority backhaul capability verification complete.\n'
