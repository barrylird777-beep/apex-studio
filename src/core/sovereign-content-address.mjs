import { createHash, timingSafeEqual } from 'node:crypto';

const PREFIX = 'apex:sha256:';
const HEX = /^[a-f0-9]{64}$/;

function normalize(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Content-addressed values must use finite numbers.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Content-addressed values must be JSON-compatible.');
  }
  if (ancestors.has(value)) throw new TypeError('Circular values cannot be content-addressed.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (!(i in value)) throw new TypeError('Sparse arrays cannot be content-addressed.');
      }
      return value.map(item => normalize(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Only plain objects can be content-addressed.');
    }
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        throw new TypeError('Content-addressed objects cannot contain undefined or executable values.');
      }
      result[key] = normalize(item, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/** Canonical JSON: stable key order and explicit rejection of ambiguous values. */
export function canonicalizeSovereignContent(value) {
  return JSON.stringify(normalize(value));
}

/** A deterministic, verifiable address for JSON data; this is not an IPFS CID. */
export function sovereignContentAddress(value) {
  const canonical = canonicalizeSovereignContent(value);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return PREFIX + digest;
}

export function verifySovereignContentAddress(value, address) {
  if (typeof address !== 'string' || !address.startsWith(PREFIX)) return false;
  const expected = address.slice(PREFIX.length);
  if (!HEX.test(expected)) return false;
  const actual = sovereignContentAddress(value).slice(PREFIX.length);
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
