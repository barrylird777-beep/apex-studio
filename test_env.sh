#!/bin/bash
set -euo pipefail
fail(){ echo "[FAIL] $1"; exit 1; }
pass(){ echo "[PASS] $1"; }
grep -q "APEX_BIND_HOST=127.0.0.1" .env.example || fail "APEX_BIND_HOST missing"
pass "Host binding default is 127.0.0.1"
grep -q "APEX_COMMANDER_TOKEN" .env.example || fail "APEX_COMMANDER_TOKEN missing"
if grep -rqi "WILLY-NILLY" --include="*.mjs" --include="*.py" --include=".env*" .; then fail "Old passphrase still present"; fi
pass "Token auth configured, no passphrase"
[ -f sanitize.mjs ] && grep -q "export function sanitizeApexInput" sanitize.mjs || fail "sanitizer missing"
pass "Sanitizer present"
if grep -nE "\beval\(|new Function\(|shell:[[:space:]]*true|\bexec(Sync)?\(" *.mjs; then fail "Dynamic evaluation or shell execution found"; fi
pass "No eval or shell execution"
grep -q "shell: false" video.mjs || fail "video.mjs must spawn with shell: false"
pass "ffmpeg runs with shell=false"
echo "[ALL CHECKS PASSED]"