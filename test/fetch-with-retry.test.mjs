import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../src/core/fetch-with-retry.mjs';

test('fetchWithRetry recovers from transient 502 after bounded jittered backoff', async () => {
  const statuses = [502, 502, 200];
  const waits = [];
  let calls = 0;
  const response = await fetchWithRetry('https://example.invalid/api', {}, {
    timeoutMs: 100,
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 4000,
    random: () => 0,
    sleepImpl: async ms => waits.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return new Response(statuses.shift() === 200 ? '{"ok":true}' : 'gateway', {
        status: calls === 3 ? 200 : 502
      });
    }
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [250, 500]);
});

test('fetchWithRetry stops after three retries and returns final gateway response', async () => {
  let calls = 0;
  const waits = [];
  const response = await fetchWithRetry('https://example.invalid/api', {}, {
    maxRetries: 3,
    random: () => 0.5,
    sleepImpl: async ms => waits.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return new Response('bad gateway', { status: 502 });
    }
  });
  assert.equal(response.status, 502);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
});

test('fetchWithRetry does not retry non-gateway HTTP errors', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://example.invalid/api', {}, {
    sleepImpl: async () => assert.fail('should not sleep'),
    fetchImpl: async () => {
      calls += 1;
      return new Response('unauthorized', { status: 401 });
    }
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 1);
});

test('fetchWithRetry honors bounded Retry-After without exceeding the cap', async () => {
  let calls = 0;
  const waits = [];
  const response = await fetchWithRetry('https://example.invalid/api', {}, {
    maxRetries: 1,
    maxDelayMs: 4000,
    random: () => 0,
    sleepImpl: async ms => waits.push(ms),
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response('gateway', { status: 502, headers: { 'retry-after': '30' } })
        : new Response('ok', { status: 200 });
    }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [4000]);
});
