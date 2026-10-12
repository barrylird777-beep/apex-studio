import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeSovereignContent,
  sovereignContentAddress,
  verifySovereignContentAddress
} from '../src/core/sovereign-content-address.mjs';

test('sovereign content address ignores object insertion order', () => {
  const first = { z: 3, nested: { b: true, a: 'value' }, a: 1 };
  const second = { a: 1, nested: { a: 'value', b: true }, z: 3 };
  assert.equal(canonicalizeSovereignContent(first), canonicalizeSovereignContent(second));
  assert.equal(sovereignContentAddress(first), sovereignContentAddress(second));
});

test('sovereign content address detects changed payloads', () => {
  const payload = { appId: 'planetapex', waveId: 'wave-1', data: { value: 1 } };
  const address = sovereignContentAddress(payload);
  assert.match(address, /^apex:sha256:[a-f0-9]{64}$/);
  assert.equal(verifySovereignContentAddress(payload, address), true);
  assert.equal(verifySovereignContentAddress({ ...payload, data: { value: 2 } }, address), false);
  assert.equal(verifySovereignContentAddress(payload, 'invalid'), false);
});

test('sovereign content address rejects ambiguous and unsafe values', () => {
  assert.throws(() => sovereignContentAddress({ value: undefined }), /JSON-compatible|undefined/);
  assert.throws(() => sovereignContentAddress({ value: Number.NaN }), /finite numbers/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => sovereignContentAddress(cyclic), /Circular/);
  assert.throws(() => sovereignContentAddress(new Date()), /plain objects/);
});
