import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeerSecurityGuard } from '../src/network/sovereign-peer-security.mjs';

test('peer guard rejects malformed envelopes and invalid identities', () => {
  const guard = createPeerSecurityGuard();
  assert.equal(guard.admit('', { type: 'ping' }).allowed, false);
  assert.equal(guard.admit('peer-a', null).allowed, false);
  assert.equal(guard.admit('peer-a', ['not', 'an', 'envelope']).allowed, false);
});

test('peer guard limits request bursts per identity', () => {
  let now = 1000;
  const guard = createPeerSecurityGuard({ now: () => now, limit: 2, windowMs: 60_000 });
  assert.equal(guard.admit('peer-a', { type: 'ping' }).allowed, true);
  assert.equal(guard.admit('peer-a', { type: 'ping' }).allowed, true);
  assert.deepEqual(guard.admit('peer-a', { type: 'ping' }), { allowed: false, reason: 'peer rate limit exceeded' });
  assert.equal(guard.admit('peer-b', { type: 'ping' }).allowed, true);
  now += 60_001;
  assert.equal(guard.admit('peer-a', { type: 'ping' }).allowed, true);
});

test('peer guard rejects replayed message identifiers from the same peer', () => {
  const guard = createPeerSecurityGuard();
  const message = { type: 'durable.accept', messageId: 'message-0001' };
  assert.equal(guard.admit('peer-a', message).allowed, true);
  assert.deepEqual(guard.admit('peer-a', message), { allowed: false, reason: 'replayed message rejected' });
  assert.equal(guard.admit('peer-b', message).allowed, true);
});

test('peer guard expires replay identifiers and rejects malformed identifiers', () => {
  let now = 1000;
  const guard = createPeerSecurityGuard({ now: () => now, replayTtlMs: 1000 });
  assert.equal(guard.admit('peer-a', { nonce: 'tiny' }).reason, 'invalid message identifier');
  const message = { nonce: 'unique-message-1' };
  assert.equal(guard.admit('peer-a', message).allowed, true);
  now += 1001;
  assert.equal(guard.admit('peer-a', message).allowed, true);
});
