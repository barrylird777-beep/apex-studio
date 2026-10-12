#!/usr/bin/env bash
# ==============================================================================
# APEX STUDIO: OFFICIAL RELEASE RUNTIME BINDING & VERIFICATION
# Target commit: 6e657537f6523049bd7b6245d37647d43eb954f1
# This script performs real checks only. It never prints SUCCESS for skipped
# or simulated checks.
# ==============================================================================

set -Eeuo pipefail

REPO="barrylird777-beep/apex-studio"
TARGET_COMMIT="946d9eec99d7f70307ad52179a75b8f59b685ad6"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=0
SKIP=0
FAIL=0

ok()   { printf '[OK]   %s\n' "$*"; PASS=$((PASS + 1)); }
skip() { printf '[SKIP] %s\n' "$*"; SKIP=$((SKIP + 1)); }
fail() { printf '[FAIL] %s\n' "$*"; FAIL=$((FAIL + 1)); }

trap 'fail "verification aborted at line $LINENO"; exit 1' ERR

echo "=========================================================================="
echo "[APEX OFFICIAL] Runtime binding & verification"
echo "=========================================================================="

# 1. Repository / target binding
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HEAD="$(git rev-parse HEAD)"
  if [[ "$HEAD" == "$TARGET_COMMIT" ]]; then
    ok "Git HEAD matches target commit $TARGET_COMMIT"
  else
    fail "Git HEAD is $HEAD; expected $TARGET_COMMIT"
  fi
else
  fail "Not inside a Git working tree"
fi

# 2. Network route
if command -v ip >/dev/null 2>&1; then
  if ip route show default | grep -q '^default '; then
    ok "Default network route exists"
    ip route show default
  else
    fail "No default network route"
  fi
elif command -v route >/dev/null 2>&1; then
  if route -n | grep -q '0.0.0.0'; then
    ok "Default network route exists"
    route -n
  else
    fail "No default network route"
  fi
else
  skip "Neither ip nor route is installed"
fi

# 3. Runtime toolchain
command -v node >/dev/null 2>&1 || { fail "Node.js is missing"; exit 1; }
command -v npm  >/dev/null 2>&1 || { fail "npm is missing"; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR >= 22 )); then
  ok "Node.js $(node --version)"
else
  fail "Node.js 22+ required; found $(node --version)"
fi

# 4. Dependency lock integrity
if [[ -f package-lock.json ]]; then
  npm ci --ignore-scripts --no-audit --no-fund
  ok "npm ci completed from package-lock.json"
else
  fail "package-lock.json is missing; refusing nondeterministic dependency install"
fi

# 5. PostgreSQL migration
if [[ -n "${DATABASE_URL:-}" ]]; then
  npm run db:migrate:postgres
  ok "PostgreSQL migration completed"
else
  skip "DATABASE_URL is not set; PostgreSQL migration not executed"
fi

# 6. Production build
npm run build
ok "Production build completed"

# 7. Official production smoke test
npm run smoke:production
ok "Production smoke test completed"

# 8. Full test suite
npm test
ok "Test suite completed"

# 9. GitHub Actions workflow presence
CI_FILE=".github/workflows/ci.yml"
if [[ -f "$CI_FILE" ]]; then
  ok "CI workflow present: $CI_FILE"
else
  fail "CI workflow missing: $CI_FILE"
fi

# 10. Optional GitHub workflow dispatch
if [[ "${DISPATCH_CI:-0}" == "1" ]]; then
  if command -v gh >/dev/null 2>&1; then
    gh auth status >/dev/null 2>&1 || { fail "gh exists but is not authenticated"; exit 1; }
    gh workflow run ci.yml --ref "$TARGET_COMMIT"
    ok "GitHub CI workflow dispatched for $TARGET_COMMIT"
  else
    fail "DISPATCH_CI=1 but gh CLI is unavailable"
  fi
else
  skip "CI dispatch disabled; set DISPATCH_CI=1 to dispatch it"
fi

# 11. Optional HTTP runtime check
if [[ -n "${BASE_URL:-}" ]]; then
  command -v curl >/dev/null 2>&1 || { fail "BASE_URL set but curl is unavailable"; exit 1; }
  curl --fail --silent --show-error --max-time 10 "$BASE_URL/api/projects" >/dev/null
  ok "Runtime endpoint reachable: $BASE_URL/api/projects"
else
  skip "BASE_URL is not set; live HTTP runtime check not executed"
fi

# 12. Optional Kubo checks. Apex does not claim Kubo unless explicitly configured.
if [[ -n "${KUBO_RPC_URL:-}" ]]; then
  command -v curl >/dev/null 2>&1 || { fail "KUBO_RPC_URL set but curl is unavailable"; exit 1; }
  curl --fail --silent --show-error --max-time 10 "$KUBO_RPC_URL/api/v0/id" >/dev/null
  ok "Kubo RPC reachable at configured private endpoint"
else
  skip "KUBO_RPC_URL is not set; Kubo verification not claimed"
fi

if [[ -n "${KUBO_GATEWAY_URL:-}" ]]; then
  command -v curl >/dev/null 2>&1 || { fail "KUBO_GATEWAY_URL set but curl is unavailable"; exit 1; }
  curl --fail --silent --show-error --max-time 10 "$KUBO_GATEWAY_URL" >/dev/null
  ok "Kubo gateway reachable at configured endpoint"
else
  skip "KUBO_GATEWAY_URL is not set; gateway verification not claimed"
fi

echo "=========================================================================="
printf '[APEX RESULT] PASS=%d SKIP=%d FAIL=%d\n' "$PASS" "$SKIP" "$FAIL"

if (( FAIL > 0 )); then
  echo "[APEX RESULT] VERIFICATION FAILED"
  exit 1
fi

echo "[APEX RESULT] VERIFICATION PASSED"
echo "=========================================================================="
