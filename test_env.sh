#!/bin/bash
set -euo pipefail
grep -q 'APEX_BIND_HOST=127.0.0.1' .env.example
grep -q 'APEX_COMMANDER_TOKEN' .env.example
grep -q 'export function sanitizeApexInput' sanitize.mjs
grep -q 'shell:false' video.mjs
if grep -rqi 'WILLY-NILLY' --include='*.mjs' --include='*.py' --include='.env*' .; then exit 1; fi
echo '[ALL CHECKS PASSED]'