import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTransferProfile, buildMultipathPlan, adaptTransferProfile } from '../src/network/throughput-profile.mjs';

test('maximum transfer profile scales parallel lanes without dropping integrity', () => {
  const p = chooseTransferProfile({ downloadMbps: 300, uploadMbps: 50, rttMs: 35, lossPct: 0.1 });
  assert.equal(p.mode, 'maximum');
  assert.equal(p.verifySha256, true);
  assert.equal(p.parallelStreams, 8);
});

test('multipath plan ranks healthy paths and preserves verification', () => {
  const p = buildMultipathPlan({ paths: [
    { device:'a', network:'wifi', healthy:true, score:20 },
    { device:'b', network:'starlink', healthy:true, score:40 },
    { device:'c', network:'cellular', healthy:false, score:100 }
  ]});
  assert.equal(p.mode, 'multipath');
  assert.equal(p.lanes[0].device, 'b');
  assert.equal(p.lanes.length, 2);
  assert.equal(p.lanes[0].verifySha256, true);
});

test('adaptive profile backs off under loss and expands on clean high throughput', () => {
  const base = chooseTransferProfile({ downloadMbps:250, uploadMbps:40, rttMs:40, lossPct:0 });
  const safe = adaptTransferProfile({ previous:base, observedMbps:100, lossPct:3, rttMs:180 });
  const max = adaptTransferProfile({ previous:base, observedMbps:300, lossPct:0.1, rttMs:30 });
  assert.ok(safe.parallelStreams < base.parallelStreams);
  assert.ok(max.parallelStreams > base.parallelStreams);
});


test('network lane policy scales toward measured capacity', async () => {
  const { adaptiveLaneCount, buildNetworkSpeedPolicy } = await import('../src/network/path-selector.mjs');
  assert.equal(adaptiveLaneCount({ bandwidthMbps: 1000, lossPct: 0.1, rttMs: 30 }), 16);
  assert.equal(adaptiveLaneCount({ bandwidthMbps: 100, lossPct: 4, rttMs: 30 }), 1);
  const p = buildNetworkSpeedPolicy([
    { device:'a', network:'wifi', healthy:true, score:20, rttMs:30 },
    { device:'b', network:'starlink', healthy:true, score:40, rttMs:50 }
  ]);
  assert.equal(p.mode, 'multipath');
  assert.equal(p.lanes, 2);
  assert.ok(p.paths[1].weight > p.paths[0].weight);
});


test('transport tuning expands in-flight capacity on clean high-bandwidth paths', async () => {
  const { buildTransportTuning, calculateBandwidthDelayProduct } = await import('../src/network/throughput-profile.mjs');
  const t = buildTransportTuning({ bandwidthMbps: 1000, rttMs: 30, lossPct: 0.1 });
  assert.equal(t.parallelStreams, 16);
  assert.equal(t.maxInFlightMiB, 512);
  assert.ok(calculateBandwidthDelayProduct({ bandwidthMbps: 1000, rttMs: 30 }) > 0);
});


test('adaptive transfer controller backs off and accelerates from measurements', async () => {
  const { buildAdaptiveTransferController } = await import('../src/network/throughput-profile.mjs');
  const controller = buildAdaptiveTransferController({ initial: { parallelStreams: 4, chunkMiB: 16 } });
  const fast = controller.observe({ observedMbps: 1000, lossPct: 0.1, rttMs: 30 });
  assert.equal(fast.parallelStreams, 6);
  assert.equal(fast.chunkMiB, 32);
  const congested = controller.observe({ observedMbps: 50, lossPct: 4, rttMs: 30 });
  assert.equal(congested.parallelStreams, 3);
  assert.equal(congested.chunkMiB, 16);
});
