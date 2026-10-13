import { encodeCanonical, decodeCanonical } from '../core/apex-cbor.mjs';

export const DEFAULT_MAX_SOVEREIGN_FRAME_BYTES = 65_536;

function limitValue(value) {
  const parsed = Number(value ?? DEFAULT_MAX_SOVEREIGN_FRAME_BYTES);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_048_576) {
    throw new RangeError('sovereign frame limit must be between 1 byte and 1 MiB');
  }
  return parsed;
}

/** Four-byte unsigned big-endian length prefix followed by canonical CBOR. */
export function encodeSovereignCborFrame(envelope, { maxBytes = DEFAULT_MAX_SOVEREIGN_FRAME_BYTES } = {}) {
  const limit = limitValue(maxBytes);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('sovereign CBOR envelope must be a map');
  }
  const payload = encodeCanonical(envelope);
  if (payload.length < 1 || payload.length > limit) {
    throw new RangeError('sovereign CBOR envelope exceeds size limit');
  }
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function decodeSovereignCborPayload(payload, { maxBytes = DEFAULT_MAX_SOVEREIGN_FRAME_BYTES } = {}) {
  const limit = limitValue(maxBytes);
  const bytes = Buffer.from(payload);
  if (bytes.length < 1 || bytes.length > limit) throw new RangeError('sovereign CBOR envelope exceeds size limit');
  const envelope = decodeCanonical(bytes);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('sovereign CBOR envelope must be a map');
  }
  return envelope;
}

export function decodeSovereignCborFrame(frame, { maxBytes = DEFAULT_MAX_SOVEREIGN_FRAME_BYTES } = {}) {
  const bytes = Buffer.from(frame);
  if (bytes.length < 5) throw new Error('sovereign CBOR frame is truncated');
  const length = bytes.readUInt32BE(0);
  if (length < 1 || length > limitValue(maxBytes)) throw new RangeError('sovereign CBOR frame length is invalid');
  if (bytes.length !== length + 4) throw new Error('sovereign CBOR frame length does not match payload');
  return decodeSovereignCborPayload(bytes.subarray(4), { maxBytes });
}
