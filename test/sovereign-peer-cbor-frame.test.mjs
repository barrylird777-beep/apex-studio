import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSovereignCborFrame,
  decodeSovereignCborFrame,
  decodeSovereignCborPayload
} from '../src/network/sovereign-peer-cbor-frame.mjs';

test('sovereign peer frame round-trips a canonical binary envelope', () => {
  const input = { protocol: 'apex.cas.v1', namespace: 'XShield', object: Buffer.from([0, 1, 2, 255]), accepted: true };
  const frame = encodeSovereignCborFrame(input);
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  const decoded = decodeSovereignCborFrame(frame);
  assert.equal(decoded.protocol, input.protocol);
  assert.equal(decoded.namespace, input.namespace);
  assert.deepEqual(decoded.object, input.object);
  assert.equal(decoded.accepted, true);
});

test('sovereign peer frame rejects a declared length mismatch', () => {
  const frame = encodeSovereignCborFrame({ accepted: true });
  const malformed = Buffer.from(frame);
  malformed.writeUInt32BE(frame.length, 0);
  assert.throws(() => decodeSovereignCborFrame(malformed), /length/);
});

test('sovereign peer frame rejects empty, array, and primitive envelopes', () => {
  assert.throws(() => encodeSovereignCborFrame({}), /size limit/);
  assert.throws(() => encodeSovereignCborFrame([]), /map/);
  assert.throws(() => encodeSovereignCborFrame('not-a-map'), /map/);
  assert.throws(() => decodeSovereignCborPayload(Buffer.from([0x80])), /map/);
});

test('sovereign peer frame enforces configured payload limits', () => {
  assert.throws(() => encodeSovereignCborFrame({ payload: 'x'.repeat(128) }, { maxBytes: 32 }), /size limit/);
  const frame = encodeSovereignCborFrame({ accepted: true });
  assert.throws(() => decodeSovereignCborFrame(frame, { maxBytes: 1 }), /length/);
  assert.throws(() => encodeSovereignCborFrame({ accepted: true }, { maxBytes: 0 }), /between 1 byte/);
});
