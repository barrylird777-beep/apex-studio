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
