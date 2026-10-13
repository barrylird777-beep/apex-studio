import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCanonical, encodeCanonical } from '../src/core/apex-cbor.mjs';

test('canonical CBOR round-trips nested app metadata and binary values', () => {
  const value = {
    app: 'PlanetApeX',
    nested: { count: 42, active: true, empty: null, values: ['a', -7, 3.25] },
    bytes: Buffer.from([0, 1, 2, 250, 255])
  };
  const recovered = decodeCanonical(encodeCanonical(value));
  assert.deepEqual(recovered, value);
});

test('canonical CBOR map ordering is independent of input key insertion order', () => {
  const a = encodeCanonical({ z: 1, a: 2, longKey: 3 });
  const b = encodeCanonical({ longKey: 3, a: 2, z: 1 });
  assert.deepEqual(a, b);
});

test('canonical CBOR rejects unsupported values and trailing bytes', () => {
  assert.throws(() => encodeCanonical({ unsupported: undefined }), /unsupported value/);
  assert.throws(() => decodeCanonical(Buffer.from([0xf6, 0xf6])), /trailing bytes/);
});

test('canonical CBOR rejects truncated data and non-string object keys', () => {
  assert.throws(() => decodeCanonical(Buffer.from([0x5a, 0, 0])), /truncated/);
  assert.throws(() => decodeCanonical(Buffer.from([0xa1, 0x01, 0x02])), /keys must be strings/);
});
