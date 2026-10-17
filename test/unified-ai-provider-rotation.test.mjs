import test from 'node:test';
import assert from 'node:assert/strict';
import { getFreeAiRotationPlan, unifiedAiStatus } from '../src/providers/unified-ai-router.mjs';

const ENV_KEYS = [
  'APEX_GROQ_FREE_TIER_CONFIRMED', 'GROQ_API_KEY',
  'APEX_GEMINI_FREE_TIER_CONFIRMED', 'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'APEX_MISTRAL_FREE_TIER_CONFIRMED', 'MISTRAL_API_KEY',
  'APEX_CLOUDFLARE_FREE_TIER_CONFIRMED', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'
];

function withEnv(values, operation) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try { return operation(); }
  finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('free provider rotation includes only explicitly configured and confirmed free tiers', () => {
  withEnv({
    GROQ_API_KEY: 'test-groq-token',
    APEX_GROQ_FREE_TIER_CONFIRMED: 'true',
    GEMINI_API_KEY: 'test-google-token',
    APEX_GEMINI_FREE_TIER_CONFIRMED: 'false',
    OPENROUTER_API_KEY: 'test-openrouter-token',
    MISTRAL_API_KEY: 'test-mistral-token',
    APEX_MISTRAL_FREE_TIER_CONFIRMED: 'true',
    CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    APEX_CLOUDFLARE_FREE_TIER_CONFIRMED: 'true'
  }, () => {
    const plan = getFreeAiRotationPlan();
    assert.equal(plan.length, 5);
    assert.deepEqual(new Set(plan), new Set(['groq', 'openrouter', 'mistral', 'cloudflare', 'pollinations']));
    const nextPlan = getFreeAiRotationPlan();
    assert.notEqual(nextPlan[0], plan[0], 'successive requests must rotate their first provider');
    assert.deepEqual(new Set(nextPlan), new Set(plan));
    assert.equal(plan.includes('google'), false);
    const status = unifiedAiStatus();
    assert.equal(status.groq.freeEligible, true);
    assert.equal(status.google.freeEligible, false);
    assert.equal(status.cloudflare.freeEligible, true);
  });
});

test('Cloudflare cannot enter free rotation without a valid account and explicit opt-in', () => {
  withEnv({
    CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
    CLOUDFLARE_ACCOUNT_ID: 'invalid-account-id',
    APEX_CLOUDFLARE_FREE_TIER_CONFIRMED: 'true'
  }, () => {
    assert.equal(getFreeAiRotationPlan().includes('cloudflare'), false);
    assert.equal(unifiedAiStatus().cloudflare.freeEligible, false);
  });
});

test('free rotation fails closed when no key-backed provider is configured and never selects paid providers', () => {
  withEnv({}, () => {
    const plan = getFreeAiRotationPlan();
    assert.deepEqual(plan, ['pollinations']);
    for (const provider of plan) {
      assert.ok(['groq', 'google', 'openrouter', 'mistral', 'cloudflare', 'pollinations'].includes(provider));
    }
    assert.equal(plan.includes('openai'), false);
    assert.equal(plan.includes('anthropic'), false);
    assert.equal(plan.includes('xai'), false);
  });
});
