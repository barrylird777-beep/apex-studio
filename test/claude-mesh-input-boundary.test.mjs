import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaudeInput } from '../src/core/mesh/claude-mesh-provider.mjs';

test('Claude mesh input bounds prompt and system instructions', () => {
  assert.deepEqual(normalizeClaudeInput('  research this  ', '  follow approved policy  '), {
    prompt: 'research this',
    system: 'follow approved policy'
  });
  assert.throws(() => normalizeClaudeInput('x'.repeat(50001), ''), /prompt exceeds configured maximum/);
  assert.throws(() => normalizeClaudeInput('valid prompt', 'x'.repeat(50001)), /system instructions exceed configured maximum/);
  assert.throws(() => normalizeClaudeInput('valid prompt', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'), error => error?.code === 'SECRET_DETECTED');
});
