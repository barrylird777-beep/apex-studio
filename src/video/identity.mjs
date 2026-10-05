import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export const canonicalStringify = (value) => JSON.stringify(canonicalize(value));

const REQUIRED = ['project', 'model', 'prompt', 'width', 'height', 'seed', 'version'];

export function generationId(params) {
  for (const key of REQUIRED) {
    if (params?.[key] === undefined || params?.[key] === null) {
      throw new Error(`generationId: missing required field "${key}"`);
    }
  }
  return createHash('sha256')
    .update(canonicalStringify(params))
    .digest('hex')
    .slice(0, 32);
}
