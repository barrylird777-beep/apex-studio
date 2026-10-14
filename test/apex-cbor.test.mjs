import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('equivalent objects produce identical CBOR bytes and SHA-256 content addresses', () => {
  const first = encodeCanonical({ a: 1, b: 2 });
  const second = encodeCanonical({ b: 2, a: 1 });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(first, second);
  assert.equal(first.length, second.length);
  assert.equal(hash(first), hash(second));
});

test('canonical CBOR rejects unsupported values and trailing bytes', () => {
  assert.throws(() => encodeCanonical({ unsupported: undefined }), /unsupported value/);
  assert.throws(() => decodeCanonical(Buffer.from([0xf6, 0xf6])), /trailing bytes/);
});

test('canonical CBOR rejects truncated data and non-string object keys', () => {
  assert.throws(() => decodeCanonical(Buffer.from([0x5a, 0, 0])), /truncated/);
  assert.throws(() => decodeCanonical(Buffer.from([0xa1, 0x01, 0x02])), /keys must be strings/);
});

test('canonical CBOR rejects duplicate map keys and non-canonical key order', () => {
  assert.throws(() => decodeCanonical(Buffer.from([0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02])), /non-canonical/);
  assert.throws(() => decodeCanonical(Buffer.from([0xa2, 0x61, 0x62, 0x01, 0x61, 0x61, 0x02])), /non-canonical/);
});

test('canonical CBOR rejects overlong integer encodings', () => {
  assert.throws(() => decodeCanonical(Buffer.from([0x18, 0x01])), /non-canonical/);
});
