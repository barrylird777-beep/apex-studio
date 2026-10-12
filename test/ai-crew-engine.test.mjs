import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiCrewEngine } from '../src/core/mesh/ai-crew-engine.mjs';

test('AI crew uses distinct assignments and preserves provider/model selection', async () => {
  const seen = [];
  const engine = createAiCrewEngine({
    concurrency: 2,
    assignments: [
      { role: 'research', provider: 'google', model: 'gemini-test', task: 'research task' },
      { role: 'qa', provider: 'anthropic', model: 'claude-test', task: 'qa task' }
    ],
    dispatch: async payload => {
      seen.push(payload);
      return { provider: payload.provider, model: payload.model, text: 'verified result' };
    }
  });

  engine.burst(2, 'test-context');
  await new Promise(resolve => setTimeout(resolve, 20));

  const status = engine.status();
  assert.equal(status.completed, 2);
  assert.equal(status.failed, 0);
  assert.deepEqual(seen.map(item => [item.provider, item.model]), [
    ['google', 'gemini-test'],
    ['anthropic', 'claude-test']
  ]);
});

test('AI crew retries failed dispatches and reports failure evidence', async () => {
  let attempts = 0;
  const engine = createAiCrewEngine({
    concurrency: 1,
    assignments: [{ role: 'qa', provider: 'google', model: 'gemini-test', task: 'retry task' }],
    dispatch: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient provider failure');
      return { text: 'recovered' };
    }
  });

  engine.burst(1);
  await new Promise(resolve => setTimeout(resolve, 800));

  const status = engine.status();
  assert.equal(attempts, 3);
  assert.equal(status.completed, 1);
  assert.equal(status.failed, 0);
  assert.equal(status.jobs[0].attempts, 3);
  assert.equal(status.jobs[0].lastError, 'transient provider failure');
});

test('AI crew does not manufacture success after terminal failure', async () => {
  const engine = createAiCrewEngine({
    concurrency: 1,
    assignments: [{ role: 'qa', provider: 'google', model: 'gemini-test', task: 'terminal task' }],
    dispatch: async () => { throw new Error('provider unavailable'); }
  });

  engine.burst(1);
  await new Promise(resolve => setTimeout(resolve, 800));

  const status = engine.status();
  assert.equal(status.completed, 0);
  assert.equal(status.failed, 1);
  assert.match(status.jobs[0].error, /provider unavailable/);
});
