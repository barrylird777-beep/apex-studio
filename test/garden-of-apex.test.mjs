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
