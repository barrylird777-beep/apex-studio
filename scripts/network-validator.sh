#!/usr/bin/env bash
set -euo pipefail

IFS=',' read -r -a TARGET_HOSTS <<< "${APEX_TARGET_HOSTS:-1.1.1.1,8.8.8.8,9.9.9.9}"
readonly TIMEOUT_SECONDS="${APEX_PING_TIMEOUT:-3}"

verify_layer_3_reachability() {
  local host
  for host in "${TARGET_HOSTS[@]}"; do
    host="${host#"\${host%%[![:space:]]*}"}"
    host="${host%"\${host##*[![:space:]]}"}"
    [[ -n "$host" ]] || continue
    if ping -c 1 -W "$TIMEOUT_SECONDS" "$host" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

main() {
  if verify_layer_3_reachability; then
    echo "STATUS: CONNECTIVITY_ESTABLISHED"
    return 0
  fi
  echo "STATUS: REACHABILITY_FAILURE"
  return 1
}

main "$@"
