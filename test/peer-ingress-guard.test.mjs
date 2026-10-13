import test from "node:test";
import assert from "node:assert/strict";
import { createPeerIngressGuard } from "../src/network/peer-ingress-guard.mjs";

test("peer ingress guard rate-limits an authenticated peer without disabling other peers", () => {
  const guard = createPeerIngressGuard({ maxRequestsPerPeer: 1, maxConcurrentPerPeer: 2, maxConcurrentTotal: 3 });
  const first = guard.acquire("peer-a");
  assert.equal(first.ok, true);
  first.release();
  assert.deepEqual(guard.acquire("peer-a").reason, "peer-rate-limit");
  const other = guard.acquire("peer-b");
  assert.equal(other.ok, true);
  other.release();
});

test("peer ingress guard enforces per-peer and network-wide concurrency, with safe idempotent release", () => {
  const guard = createPeerIngressGuard({ maxRequestsPerPeer: 10, maxConcurrentPerPeer: 1, maxConcurrentTotal: 2 });
  const first = guard.acquire("peer-a");
  assert.equal(first.ok, true);
  assert.equal(guard.acquire("peer-a").reason, "peer-concurrency-limit");
  const second = guard.acquire("peer-b");
  assert.equal(second.ok, true);
  assert.equal(guard.acquire("peer-c").reason, "network-concurrency-limit");
  first.release();
  first.release();
  second.release();
  assert.deepEqual(guard.snapshot(), { trackedPeers: 3, activeTotal: 0 });
});

test("peer ingress guard refuses missing identities and bounds peer tracking", () => {
  const guard = createPeerIngressGuard({ maxTrackedPeers: 2, maxRequestsPerPeer: 5 });
  assert.equal(guard.acquire("").reason, "missing-peer-identity");
  const first = guard.acquire("peer-a");
  first.release();
  const second = guard.acquire("peer-b");
  second.release();
  // Do not evict unexpired peers just to admit a new identity; fail closed at capacity.
  const third = guard.acquire("peer-c");
  assert.equal(third.ok, false);
  assert.equal(third.reason, "peer-tracking-capacity");
  assert.equal(guard.snapshot().trackedPeers, 2);
});
