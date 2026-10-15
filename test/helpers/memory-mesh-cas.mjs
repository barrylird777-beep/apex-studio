import { createHash } from 'node:crypto';
import { encodeCanonical } from '../../src/core/apex-cbor.mjs';

const digest = value => createHash('sha256').update(encodeCanonical(value)).digest('hex');

export class MemoryMeshCAS {
  constructor() { this.refs = new Map(); }
  async init() { return this; }
  async readRef(namespace, key) {
    const row = this.refs.get(namespace + '/' + key);
    return row ? { namespace, key, hash: row.hash, value: structuredClone(row.value) } : null;
  }
  async writeRef(namespace, key, value, { expectedHash } = {}) {
    const id = namespace + '/' + key;
    const current = this.refs.get(id);
    const actual = current?.hash ?? null;
    if (expectedHash !== undefined && actual !== expectedHash) {
      throw Object.assign(new Error('peer CAS conflict'), { code: 'CAS_CONFLICT' });
    }
    const hash = digest(value);
    this.refs.set(id, { hash, value: structuredClone(value) });
    return { namespace, key, hash };
  }
  async deleteRef(namespace, key, { expectedHash = null } = {}) {
    const id = namespace + '/' + key;
    const current = this.refs.get(id);
    if (!current) return false;
    if (expectedHash !== null && current.hash !== expectedHash) {
      throw Object.assign(new Error('peer CAS conflict'), { code: 'CAS_CONFLICT' });
    }
    this.refs.delete(id);
    return true;
  }
  async listRefs(namespace) {
    const prefix = namespace + '/';
    return [...this.refs.entries()].filter(([id]) => id.startsWith(prefix)).map(([id, row]) => ({
      namespace, key: id.slice(prefix.length), hash: row.hash, value: structuredClone(row.value)
    }));
  }
}
