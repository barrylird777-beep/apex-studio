import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LocalCasFastPath } from '../src/core/local-cas-fast-path.mjs';

const cid = bytes => createHash('sha256').update(bytes).digest('hex');

test('local CAS stores immutable CID bytes without exposing mutable aliases', () => {
  const fast = new LocalCasFastPath({ maxBytes: 1024 });
  const source = Buffer.from('immutable bytes');
  const stored = fast.putImmutable(source);
  assert.equal(stored.cid, cid(source));
  assert.equal(stored.cached, true);
  source.fill(0);
  const first = fast.getImmutable(stored.cid);
  assert.equal(first.toString(), 'immutable bytes');
  first.fill(0);
  assert.equal(fast.getImmutable(stored.cid).toString(), 'immutable bytes');
});

test('local CAS compare-and-swap atomically rejects a stale concurrent writer', async () => {
  const fast = new LocalCasFastPath({ maxBytes: 1024 });
  const a = fast.putImmutable(Buffer.from('A')).cid;
  const b = fast.putImmutable(Buffer.from('B')).cid;
  const c = fast.putImmutable(Buffer.from('C')).cid;
  fast.compareAndSwap('library/main', null, a);
  const attempts = await Promise.allSettled([
    Promise.resolve().then(() => fast.compareAndSwap('library/main', a, b)),
    Promise.resolve().then(() => fast.compareAndSwap('library/main', a, c))
  ]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(x => x.status === 'rejected' && x.reason.code === 'CAS_CONFLICT').length, 1);
  assert.ok([b, c].includes(fast.readHead('library/main')));
});

test('local CAS enforces byte budget with LRU eviction and never exceeds capacity', () => {
  const fast = new LocalCasFastPath({ maxBytes: 8, ttlMs: 1000 });
  const a = fast.putImmutable(Buffer.from('aaaa')).cid;
  const b = fast.putImmutable(Buffer.from('bbbb')).cid;
  assert.equal(fast.getImmutable(a).toString(), 'aaaa');
  const c = fast.putImmutable(Buffer.from('cccc')).cid;
  assert.equal(fast.getImmutable(b), null);
  assert.equal(fast.getImmutable(a).toString(), 'aaaa');
  assert.equal(fast.getImmutable(c).toString(), 'cccc');
  assert.ok(fast.stats().objectBytes <= 8);
});

test('local CAS expires immutable objects and heads without persistence', () => {
  let now = 100;
  const fast = new LocalCasFastPath({ maxBytes: 1024, ttlMs: 10, now: () => now });
  const value = fast.putImmutable(Buffer.from('short-lived'));
  fast.compareAndSwap('head', null, value.cid);
  assert.equal(fast.readHead('head'), value.cid);
  now = 111;
  assert.equal(fast.getImmutable(value.cid), null);
  assert.equal(fast.readHead('head'), null);
  assert.deepEqual(fast.stats(), { objectCount: 0, objectBytes: 0, headCount: 0, maxBytes: 1024, ttlMs: 10, maxHeads: 4096 });
});

test('local CAS can be disabled and bounds pointer metadata', () => {
  const disabled = new LocalCasFastPath({ maxBytes: 0 });
  const item = disabled.putImmutable(Buffer.from('not cached'));
  assert.equal(item.cached, false);
  assert.equal(disabled.getImmutable(item.cid), null);
  assert.throws(() => disabled.compareAndSwap('head', null, item.cid), error => error.code === 'OBJECT_UNAVAILABLE');

  const bounded = new LocalCasFastPath({ maxBytes: 1024, maxHeads: 2 });
  const a = bounded.putImmutable(Buffer.from('a')).cid;
  const b = bounded.putImmutable(Buffer.from('b')).cid;
  const c = bounded.putImmutable(Buffer.from('c')).cid;
  bounded.compareAndSwap('head-a', null, a);
  bounded.compareAndSwap('head-b', null, b);
  bounded.readHead('head-a');
  bounded.compareAndSwap('head-c', null, c);
  assert.equal(bounded.stats().headCount, 2);
  assert.equal(bounded.readHead('head-b'), null);
  assert.equal(bounded.readHead('head-a'), a);
  assert.equal(bounded.readHead('head-c'), c);
});

test('local CAS rejects unsafe keys and invalid CIDs', () => {
  const fast = new LocalCasFastPath();
  assert.throws(() => fast.readHead('../escape'), /invalid local CAS key/);
  assert.throws(() => fast.getImmutable('not-a-cid'), /invalid immutable content ID/);
  assert.throws(() => fast.compareAndSwap('head', null, 'not-a-cid'), /invalid next content ID/);
});
