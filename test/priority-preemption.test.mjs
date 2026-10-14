import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriorityPreemption, PRIORITY } from '../src/core/priority-preemption.mjs';

function child() {
  return { exitCode: null, signalCode: null, kill() { throw new Error('signals must not be used'); } };
}

test('paid work requires a checkpoint and resource-release acknowledgement, then resumes', async () => {
  const gate = createPriorityPreemption({ logger: { warn() {}, error() {} } });
  const ffmpeg = child();
  const events = [];
  gate.registerBackground('render-1', ffmpeg, {
    pause: async () => { events.push('checkpoint-and-release'); return { segment: 4, resourceReleased: true }; },
    resume: async checkpoint => { events.push('resume-segment-' + checkpoint.segment); }
  });
  const result = await gate.run(PRIORITY.PAID_INFERENCE, async () => {
    assert.deepEqual(events, ['checkpoint-and-release']);
    return 'inference-result';
  });
  assert.equal(result, 'inference-result');
  assert.deepEqual(events, ['checkpoint-and-release', 'resume-segment-4']);
});

test('paid inference fails closed when a running background child cannot cooperatively yield', async () => {
  const gate = createPriorityPreemption();
  gate.registerBackground('render-unsafe', child());
  await assert.rejects(
    () => gate.run(PRIORITY.PAID_INFERENCE, async () => 'must-not-run'),
    /no cooperative checkpoint\/release handler/
  );
  assert.equal(gate.status().paidActive, 0);
});

test('unknown priorities are rejected and paid activity is tracked', async () => {
  const gate = createPriorityPreemption();
  await assert.rejects(() => gate.run(9, async () => true), /unsupported execution priority/);
  const result = await gate.run(PRIORITY.PAID_INFERENCE, async () => gate.status().paidActive);
  assert.equal(result, 1);
  assert.equal(gate.status().paidActive, 0);
});

test('exited children are ignored', async () => {
  const gate = createPriorityPreemption();
  const exited = child();
  exited.exitCode = 0;
  gate.registerBackground('finished', exited);
  await gate.run(PRIORITY.PAID_INFERENCE, async () => true);
});

test('a stalled cooperative checkpoint times out instead of hanging paid admission', async () => {
  const gate = createPriorityPreemption({ checkpointTimeoutMs: 15, logger: { warn() {}, error() {} } });
  const ffmpeg = child();
  gate.registerBackground('stalled-render', ffmpeg, {
    pause: () => new Promise(() => {}),
    resume: async () => {}
  });
  await assert.rejects(
    () => gate.run(PRIORITY.PAID_INFERENCE, async () => 'must-not-run'),
    /checkpoint timed out/
  );
  assert.equal(gate.status().paidActive, 0);
  assert.equal(gate.status().paidWaiting, 0);
});

test('paid inference requests are serialized around the shared execution lane', async () => {
  const gate = createPriorityPreemption();
  const events = [];
  let finishFirst;
  const first = gate.run(PRIORITY.PAID_INFERENCE, async () => {
    events.push('first-start');
    await new Promise(resolve => { finishFirst = resolve; });
    events.push('first-end');
  });
  const second = gate.run(PRIORITY.PAID_INFERENCE, async () => { events.push('second-start'); });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events, ['first-start']);
  finishFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start']);
});

test('background jobs remain paused across consecutive queued paid requests', async () => {
  const gate = createPriorityPreemption();
  const events = [];
  gate.registerBackground('render-queued', child(), {
    pause: async () => { events.push('pause'); return { segment: 8, resourceReleased: true }; },
    resume: async () => { events.push('resume'); }
  });
  let finishFirst;
  const first = gate.run(PRIORITY.PAID_INFERENCE, async () => {
    events.push('paid-1-start');
    await new Promise(resolve => { finishFirst = resolve; });
    events.push('paid-1-end');
  });
  const second = gate.run(PRIORITY.PAID_INFERENCE, async () => { events.push('paid-2'); });
  await new Promise(resolve => setTimeout(resolve, 10));
  finishFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['pause', 'paid-1-start', 'paid-1-end', 'paid-2', 'resume']);
});

test('checkpoint handlers must be paired', () => {
  const gate = createPriorityPreemption();
  assert.throws(
    () => gate.registerBackground('bad-pair', child(), { pause: async () => ({ resourceReleased: true }) }),
    /pause and resume handlers must be supplied together/
  );
});
