import { performance } from 'node:perf_hooks';

const url = process.env.APEX_NETWORK_BENCHMARK_URL || 'https://speed.hetzner.de/100MB.bin';
const durationLimitMs = Math.max(1000, Number(process.env.APEX_NETWORK_BENCHMARK_MAX_MS || 120000));

async function main() {
  const started = performance.now();
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`benchmark HTTP ${response.status}`);
  let bytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (performance.now() - started > durationLimitMs) {
      await reader.cancel();
      break;
    }
  }
  const elapsedMs = Math.max(1, performance.now() - started);
  const mbps = (bytes * 8) / (elapsedMs / 1000) / 1e6;
  console.log(JSON.stringify({
    type: 'network-throughput-benchmark',
    url,
    bytes,
    elapsedMs: Math.round(elapsedMs),
    mbps: Number(mbps.toFixed(2)),
    completed: bytes > 0 && elapsedMs < durationLimitMs,
    measuredAt: new Date().toISOString()
  }));
}

main().catch(error => {
  console.error(JSON.stringify({
    type: 'network-throughput-benchmark',
    ok: false,
    error: String(error?.message || error),
    measuredAt: new Date().toISOString()
  }));
  process.exitCode = 1;
});
