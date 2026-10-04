import { createHash } from 'node:crypto';

export function canonicalStringify(v) {
  if (v === undefined) throw new Error('cannot canonicalize undefined');
  return walk(v);
}
function walk(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number') {
    if (!Number.isFinite(v)) throw new Error('cannot canonicalize a non-finite number');
    return JSON.stringify(v);
  }
  if (t === 'string' || t === 'boolean') return JSON.stringify(v);
  if (t === 'bigint' || t === 'function' || t === 'symbol') throw new Error(`cannot canonicalize ${t}`);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : walk(x))).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${walk(v[k])}`).join(',')}}`;
}
export function generationId({ project, model, prompt, width, height, seed = 0, version }) {
  for (const [k, v] of Object.entries({ project, model, prompt, version })) {
    if (typeof v !== 'string' || !v) throw new Error(`generationId: ${k} is required`);
  }
  return createHash('sha256').update(canonicalStringify({ project, model, prompt, width, height, seed, version })).digest('hex').slice(0, 32);
}
