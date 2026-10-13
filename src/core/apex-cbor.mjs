const concat = parts => Buffer.concat(parts);

function head(major, value) {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n) throw new RangeError('CBOR length must be non-negative');
  if (n < 24n) return Buffer.from([(major << 5) | Number(n)]);
  if (n <= 0xffn) return Buffer.from([(major << 5) | 24, Number(n)]);
  if (n <= 0xffffn) {
    const out = Buffer.alloc(3); out[0] = (major << 5) | 25; out.writeUInt16BE(Number(n), 1); return out;
  }
  if (n <= 0xffffffffn) {
    const out = Buffer.alloc(5); out[0] = (major << 5) | 26; out.writeUInt32BE(Number(n), 1); return out;
  }
  if (n <= 0xffffffffffffffffn) {
    const out = Buffer.alloc(9); out[0] = (major << 5) | 27; out.writeBigUInt64BE(n, 1); return out;
  }
  throw new RangeError('CBOR integer exceeds the 64-bit encoding range');
}

export function encodeCanonical(value) {
  if (value === null) return Buffer.from([0xf6]);
  if (value === false) return Buffer.from([0xf4]);
  if (value === true) return Buffer.from([0xf5]);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite numbers are not supported in canonical CBOR');
    if (Number.isSafeInteger(value)) return value >= 0 ? head(0, value) : head(1, BigInt(-1 - value));
    const out = Buffer.alloc(9); out[0] = 0xfb; out.writeDoubleBE(value, 1); return out;
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8'); return concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value); return concat([head(2, bytes.length), bytes]);
  }
  if (Array.isArray(value)) return concat([head(4, value.length), ...value.map(encodeCanonical)]);
  if (value && typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const entries = Object.keys(value).map(key => ({ encodedKey: encodeCanonical(key), encodedValue: encodeCanonical(value[key]) }));
    entries.sort((a, b) => a.encodedKey.length - b.encodedKey.length || Buffer.compare(a.encodedKey, b.encodedKey));
    return concat([head(5, entries.length), ...entries.flatMap(entry => [entry.encodedKey, entry.encodedValue])]);
  }
  throw new TypeError('unsupported value for canonical CBOR encoding');
}

export function decodeCanonical(input) {
  const bytes = Buffer.from(input);
  let offset = 0;
  function read(size) {
    if (offset + size > bytes.length) throw new Error('truncated CBOR value');
    const result = bytes.subarray(offset, offset + size); offset += size; return result;
  }
  function readLength(additional) {
    if (additional < 24) return BigInt(additional);
    if (additional === 24) return BigInt(read(1)[0]);
    if (additional === 25) return BigInt(read(2).readUInt16BE(0));
    if (additional === 26) return BigInt(read(4).readUInt32BE(0));
    if (additional === 27) return read(8).readBigUInt64BE(0);
    throw new Error('indefinite or reserved CBOR length is not supported');
  }
  function asLength(n) {
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR container length exceeds safe limits');
    return Number(n);
  }
  function parse() {
    const initial = read(1)[0], major = initial >> 5, additional = initial & 31;
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
      if (additional === 27) return read(8).readDoubleBE(0);
      throw new Error('unsupported CBOR simple or floating-point value');
    }
    const length = readLength(additional);
    if (major === 0) return length <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(length) : length;
    if (major === 1) { const n = -1n - length; return n >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(n) : n; }
    if (major === 2) return Buffer.from(read(asLength(length)));
    if (major === 3) return read(asLength(length)).toString('utf8');
    if (major === 4) {
      const count = asLength(length), result = [];
      for (let i = 0; i < count; i++) result.push(parse());
      return result;
    }
    if (major === 5) {
      const count = asLength(length), result = {};
      for (let i = 0; i < count; i++) {
        const key = parse();
        if (typeof key !== 'string') throw new Error('canonical CBOR object keys must be strings');
        Object.defineProperty(result, key, { value: parse(), enumerable: true, configurable: true, writable: true });
      }
      return result;
    }
    throw new Error('unsupported CBOR major type');
  }
  const value = parse();
  if (offset !== bytes.length) throw new Error('trailing bytes after CBOR value');
  return value;
}
