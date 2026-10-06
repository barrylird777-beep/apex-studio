import test from 'node:test';
import assert from 'node:assert/strict';
import { GARDEN_OF_APEX, assertGardenFreakKind } from '../src/garden/garden-of-apex.mjs';

test('Garden of Apex is a separate Jesus Freak domain', () => {
  assert.equal(GARDEN_OF_APEX.name, 'THE Garden of Apex');
  assert.equal(GARDEN_OF_APEX.collective, 'Jesus Freaks');
  assert.deepEqual(GARDEN_OF_APEX.freakKinds, ['kernel', 'popcorn', 'cornnut', 'cob', 'protocob']);
  assert.equal(GARDEN_OF_APEX.freakKinds.includes('studio'), false);
});
test('Kernet is a life stage, not a Freak kind or information unit', () => {
  assert.equal(GARDEN_OF_APEX.lifeStages.includes('kernet'), true);
  assert.throws(() => assertGardenFreakKind('kernet'), /Unknown Garden Freak kind/);
});

test('Garden domain vocabulary preserves the discovery lineage model', () => {
  assert.deepEqual(GARDEN_OF_APEX.discoveryKinds, ['popcorn','protocob','insight','artifact']);
  assert.equal(GARDEN_OF_APEX.freakKinds.includes('cornnut'), true);
});

import fs from 'node:fs';

test('Garden world migration is self-contained and preserves migration immutability', () => {
  const migration = fs.readFileSync(new URL('../postgres/migrations/0013_garden_world_state.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "parent_id"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "garden_events"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "garden_freak_state"/);
  assert.match(migration, /\('freak-groves','Freak Groves'/);
  assert.match(migration, /\('discovery-fields','Discovery Fields'/);
  assert.match(migration, /\('kornworks','KornWorks'/);
  assert.match(migration, /\('story-gardens','Story Gardens'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "garden_freak_specialties"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "garden_discovery_links"/);
});
