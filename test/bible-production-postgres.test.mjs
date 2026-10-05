import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Bible production route is PostgreSQL-only', async () => {
  const source = await readFile(new URL('../src/api/bible-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /from ['"]pg['"]/);
  assert.doesNotMatch(source, /sqlite3|\.sqlite|new sqlite/i);
  assert.match(source, /DATABASE_URL/);
  assert.match(source, /shoot_day_scenes/);
});
