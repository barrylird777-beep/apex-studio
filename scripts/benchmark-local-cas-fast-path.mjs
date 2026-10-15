import { performance } from 'node:perf_hooks';
import { LocalCasFastPath } from '../src/core/local-cas-fast-path.mjs';

const iterations = Math.max(1000, Math.min(10_000, Number(process.env.APEX_CAS_BENCH_ITERATIONS || 5000)));
const fast = new LocalCasFastPath({ maxBytes: 16 * 1024 * 1024, maxObjects: 12_000, maxHeads: 4096, ttlMs: 60_000 });
const payloads = Array.from({ length: iterations + 200 }, (_, i) =>
  Buffer.from('apex-local-cas-benchmark-' + String(i).padStart(6, '0') + ':' + 'x'.repeat(1000))
);
const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(4));
};
function measure(label, count, operation) {
  for (let i = 0; i < 200; i++) operation(i, true);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    operation(i, false);
    samples.push(performance.now() - start);
  }
  return {
    operation: label,
    samples: samples.length,
    p50Ms: quantile(samples, 0.50),
    p95Ms: quantile(samples, 0.95),
    p99Ms: quantile(samples, 0.99)
  };
}

let payloadIndex = 0;
const put = measure('immutable_put_hash_and_copy', iterations, (_i, warmup) => {
  const payload = payloads[payloadIndex++];
  const result = fast.putImmutable(payload);
  if (!result.cached) throw new Error('benchmark object unexpectedly bypassed the RAM cache');
});
const seedA = fast.putImmutable(Buffer.from('pointer-target-A')).cid;
const seedB = fast.putImmutable(Buffer.from('pointer-target-B')).cid;
fast.compareAndSwap('benchmark/head', null, seedA);
let current = seedA;
const cas = measure('atomic_local_pointer_compare_and_swap', iterations, () => {
  const next = current === seedA ? seedB : seedA;
  fast.compareAndSwap('benchmark/head', current, next);
  current = next;
});
const read = measure('immutable_ram_hit_defensive_copy', iterations, () => {
  const bytes = fast.getImmutable(seedA);
  if (!bytes || bytes.toString() !== 'pointer-target-A') throw new Error('RAM hit failed verification');
});
console.log(JSON.stringify({
  benchmark: 'synthetic in-process RAM only',
  networkIncluded: false,
  peerDurabilityClaim: false,
  note: 'These measurements are local microbenchmarks, not independent-peer or hardware-root performance evidence.',
  iterations,
  cache: fast.stats(),
  results: [put, cas, read]
}, null, 2));
