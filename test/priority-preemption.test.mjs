import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriorityPreemption, PRIORITY } from '../src/core/priority-preemption.mjs';

function child() {
  const signals = [];
  return { signals, exitCode: null, signalCode: null, kill(signal) { signals.push(signal); return true; } };
}

test('paid work pauses registered background children and resumes them after completion', async () => {
  const gate = createPriorityPreemption({ logger: { warn() {}, error() {} } });
  const ffmpeg = child();
  gate.registerBackground('render-1', ffmpeg);
  const result = await gate.run(PRIORITY.PAID_INFERENCE, async () => {
    assert.deepEqual(ffmpeg.signals, ['SIGSTOP']);
    return 'inference-result';
  });
  assert.equal(result, 'inference-result');
  assert.deepEqual(ffmpeg.signals, ['SIGSTOP', 'SIGCONT']);
});

test('background work is rejected for unknown priorities and paid requests track activity', async () => {
  const gate = createPriorityPreemption();
  await assert.rejects(() => gate.run(9, async () => true), /unsupported execution priority/);
  const result = await gate.run(PRIORITY.PAID_INFERENCE, async () => gate.status().paidActive);
  assert.equal(result, 1);
  assert.equal(gate.status().paidActive, 0);
});

test('exited children are not signalled', async () => {
  const gate = createPriorityPreemption();
  const exited = child();
  exited.exitCode = 0;
  gate.registerBackground('finished', exited);
  await gate.run(PRIORITY.PAID_INFERENCE, async () => true);
  assert.deepEqual(exited.signals, []);
});
