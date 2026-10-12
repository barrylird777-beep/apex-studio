import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, backoffMs } from '../src/jobs/queue.mjs';
import { createMemoryStore } from '../src/jobs/memory-store.mjs';
import { createOverseer, nonRetryable } from '../src/jobs/overseer.mjs';
import { getStatus, createStatusHandler } from '../src/jobs/status.mjs';

function mk(opts = {}) {
  const clock = { t: 1_000_000 };
  let n = 0;
  const queue = createQueue({
    store: createMemoryStore(), now: () => clock.t, token: () => `tok-${++n}`,
    leaseMs: 1000, baseBackoffMs: 100, maxBackoffMs: 10_000, ...opts,
  });
  return { clock, queue };
}

test('backoff doubles and caps', () => {
  assert.equal(backoffMs(1, 100, 1000), 100);
  assert.equal(backoffMs(3, 100, 1000), 400);
  assert.equal(backoffMs(9, 100, 1000), 1000);
});

test('claim leases the oldest due job; nothing due returns null', async () => {
  const { clock, queue } = mk();
  assert.equal(await queue.claim('w1'), null);
  const a = await queue.enqueue({ type: 't', payload: { n: 1 } });
  await queue.enqueue({ type: 't', payload: { n: 2 } });
  await queue.enqueue({ type: 't', payload: { n: 3 }, runAt: clock.t + 5000 });
  const j = await queue.claim('w1');
  assert.equal(j.id, a.id);
  assert.equal(j.attempts, 1);
  assert.equal(j.leaseToken, 'tok-1');
  assert.equal((await queue.claim('w2')).payload.n, 2);
  assert.equal(await queue.claim('w3'), null);
});

test('dedupeKey returns the live job instead of a duplicate', async () => {
  const { queue } = mk();
  const a = await queue.enqueue({ type: 't', dedupeKey: 'k' });
  const b = await queue.enqueue({ type: 't', dedupeKey: 'k' });
  assert.equal(a.id, b.id);
  assert.equal((await queue.store.counts()).queued, 1);
  const j = await queue.claim('w');
  await queue.complete(j);
  const c = await queue.enqueue({ type: 't', dedupeKey: 'k' });
  assert.notEqual(c.id, a.id);
});

test('failures retry with backoff, then go dead at maxAttempts', async () => {
  const { clock, queue } = mk();
  await queue.enqueue({ type: 't', maxAttempts: 2 });
  let j = await queue.claim('w');
  assert.equal(await queue.fail(j, new Error('boom')), true);
  assert.equal(await queue.claim('w'), null);
  clock.t += 100;
  j = await queue.claim('w');
  assert.equal(j.attempts, 2);
  await queue.fail(j, new Error('boom again'));
  const c = await queue.store.counts();
  assert.deepEqual([c.queued, c.dead], [0, 1]);
});

test('non-retryable errors go straight to dead', async () => {
  const { queue } = mk();
  await queue.enqueue({ type: 't' });
  await queue.fail(await queue.claim('w'), nonRetryable('bad payload'));
  assert.equal((await queue.store.counts()).dead, 1);
});

test('stale lease is recovered, the old worker is fenced out, the new claim gets a new token', async () => {
  const { clock, queue } = mk();
  await queue.enqueue({ type: 't' });
  const j1 = await queue.claim('w1');
  clock.t += 1500;
  const rec = await queue.recoverStale();
  assert.equal(rec.length, 1);
  assert.equal(rec[0].dead, false);
  assert.equal(await queue.claim('w2'), null);
  clock.t += 100;
  const j2 = await queue.claim('w2');
  assert.equal(j2.attempts, 2);
  assert.notEqual(j2.leaseToken, j1.leaseToken);
  assert.equal(await queue.complete(j1), false);
  assert.equal(await queue.heartbeat(j1), false);
  assert.equal(await queue.complete(j2, { ok: 1 }), true);
});

test('crash recovery marks a job dead when attempts are exhausted; live leases are untouched', async () => {
  const { clock, queue } = mk();
  await queue.enqueue({ type: 't', maxAttempts: 1 });
  await queue.claim('w1');
  clock.t += 500;
  assert.equal((await queue.recoverStale()).length, 0);
  clock.t += 600;
  const rec = await queue.recoverStale();
  assert.equal(rec[0].dead, true);
  assert.equal((await queue.store.counts()).dead, 1);
});

test('heartbeat extends the lease so recovery skips the job', async () => {
  const { clock, queue } = mk();
  await queue.enqueue({ type: 't' });
  const j = await queue.claim('w1');
  clock.t += 900;
  assert.equal(await queue.heartbeat(j), true);
  clock.t += 900;
  assert.equal((await queue.recoverStale()).length, 0);
});

test('overseer runs handlers, completes jobs, retries throwers, kills unknown types', async () => {
  const { queue } = mk();
  const seen = [];
  const ov = createOverseer({
    queue, workerId: 'w', heartbeatMs: 1e9,
    handlers: {
      ok: async (p) => { seen.push(p.n); return { doubled: p.n * 2 }; },
      boom: async () => { throw new Error('transient'); },
    },
  });
  await queue.enqueue({ type: 'ok', payload: { n: 21 } });
  await queue.enqueue({ type: 'boom' });
  await queue.enqueue({ type: 'mystery' });
  assert.equal((await ov.runOnce()).status, 'done');
  assert.equal((await ov.runOnce()).status, 'failed');
  assert.equal((await ov.runOnce()).status, 'failed');
  assert.equal(await ov.runOnce(), null);
  assert.deepEqual(seen, [21]);
  const c = await queue.store.counts();
  assert.deepEqual([c.done, c.queued, c.dead], [1, 1, 1]);
  assert.equal((await queue.store.listByStatus('done'))[0].result.doubled, 42);
});

test('a worker whose lease was recovered mid-run reports lease_lost and cannot overwrite state', async () => {
  const { clock, queue } = mk();
  const ov = createOverseer({
    queue, workerId: 'slow', heartbeatMs: 1e9,
    handlers: { slow: async () => { clock.t += 5000; await queue.recoverStale(); return 'late'; } },
  });
  await queue.enqueue({ type: 'slow' });
  assert.equal((await ov.runOnce()).status, 'lease_lost');
  const c = await queue.store.counts();
  assert.deepEqual([c.queued, c.done], [1, 0]);
});

test('status reports counts, retrying, recovered and stale workers without leaking tokens', async () => {
  const { clock, queue } = mk();
  await queue.enqueue({ type: 't', payload: { secret: 'x' } });
  await queue.claim('w1');
  clock.t += 1500;
  await queue.recoverStale();
  await queue.touchWorker('old');
  clock.t += 60_000;
  await queue.touchWorker('fresh');
  const st = await getStatus(queue, { staleWorkerMs: 30_000 });
  assert.equal(st.counts.queued, 1);
  assert.equal(st.retrying.length, 1);
  assert.equal(st.recovered.length, 1);
  assert.deepEqual(st.staleWorkers.map((w) => w.id).sort(), ['old', 'w1']);
  const text = JSON.stringify(st);
  assert.ok(!text.includes('secret') && !text.includes('leaseToken'));

  let body;
  const res = { setHeader() {}, end(b) { body = JSON.parse(b); } };
  assert.equal(await createStatusHandler(queue)({ method: 'GET', url: '/jobs/status' }, res), true);
  assert.equal(body.counts.queued, 1);
  assert.equal(await createStatusHandler(queue)({ method: 'POST', url: '/jobs/status' }, res), false);
  assert.equal(await createStatusHandler(queue)({ method: 'GET', url: '/other' }, res), false);
});
