import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeminiInput } from '../src/core/mesh/gemini-mesh-provider.mjs';

test('Gemini mesh input bounds prompt and system instructions', () => {
  assert.deepEqual(normalizeGeminiInput('  research this  ', '  follow approved policy  '), {
    prompt: 'research this',
    system: 'follow approved policy'
  });
  assert.throws(() => normalizeGeminiInput('x'.repeat(50001), ''), /prompt exceeds configured maximum/);
  assert.throws(() => normalizeGeminiInput('valid prompt', 'x'.repeat(50001)), /system instructions exceed configured maximum/);
  assert.throws(() => normalizeGeminiInput('valid prompt', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'), error => error?.code === 'SECRET_DETECTED');
});
