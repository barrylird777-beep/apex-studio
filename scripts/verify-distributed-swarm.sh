#!/usr/bin/env bash
set -euo pipefail

echo "=== [1/2] Verifying Canonical Durable Worker Swarm Configuration ==="
node --input-type=module -e '
import { APEX_LIMITS } from "./src/core/mesh/apex-limits.mjs";
console.log("Worker Concurrency:", APEX_LIMITS.WORKER.CONCURRENCY);
console.log("Worker Concurrency Ceiling:", APEX_LIMITS.WORKER.MAX_CONCURRENCY);
console.log("Batch Size:", APEX_LIMITS.WORKER.BATCH_SIZE);
console.log("Batch Size Ceiling:", APEX_LIMITS.WORKER.MAX_BATCH_SIZE);
console.log("Lease TTL (s):", APEX_LIMITS.WORKER.LEASE_TTL_SECONDS);
'

echo "=== [2/2] Dispatching Durable Swarm Task Through Canonical Store ==="
node scripts/dispatch-distributed-swarm.mjs
