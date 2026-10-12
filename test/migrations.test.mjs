import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyMigrations } from '../scripts/verifyMigrations.js';

const expectations = {
  tables: ['projects', 'scenes', 'shoot_days', 'shoot_day_scenes'],
  primaryKeys: [{ table: 'shoot_day_scenes', columns: ['scene_id'] }],
  unique: [{ table: 'shoot_days', columns: ['project_id', 'date'] }],
  indexes: [
    { table: 'shoot_day_scenes', columns: ['shoot_day_id', 'position'] },
    { table: 'shoot_days', columns: ['project_id', 'date'] },
  ],
  foreignKeys: [
    { table: 'shoot_day_scenes', column: 'shoot_day_id', references: 'shoot_days', onDelete: 'CASCADE' },
    { table: 'shoot_day_scenes', column: 'scene_id', references: 'scenes', onDelete: 'CASCADE' },
  ],
};

test('committed migrations rebuild SPEC-005 schema from empty SQLite', () => {
  const result = verifyMigrations({ dir: 'drizzle', expectations });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.ok(result.migrationCount > 0);
});
