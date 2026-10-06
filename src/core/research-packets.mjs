import crypto from 'node:crypto';

export const RESEARCH_PACKET_VERSION = 1;

function canonical(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

export function createResearchPacket({
  id,
  title,
  domain = 'algorithm',
  question,
  hypothesis,
  algorithm = null,
  metrics = [],
  experiment = null,
  evidence = [],
  constraints = [],
  status = 'proposed',
  owner = 'apex'
} = {}) {
  if (!title || !question) throw new Error('title and question are required');
  const packet = {
    version: RESEARCH_PACKET_VERSION,
    id: id || `research-${crypto.randomUUID()}`,
    title, domain, question, hypothesis: hypothesis || null,
    algorithm, metrics, experiment, evidence, constraints, status, owner,
    createdAt: new Date().toISOString()
  };
  packet.fingerprint = crypto.createHash('sha256').update(canonical(packet)).digest('hex');
  return Object.freeze(packet);
}

export function scoreResearchResult({ expected, observed, tolerance = 0 } = {}) {
  const e = Number(expected), o = Number(observed), t = Math.max(0, Number(tolerance) || 0);
  if (!Number.isFinite(e) || !Number.isFinite(o)) return { valid: false, score: 0, error: 'expected and observed must be finite numbers' };
  const error = Math.abs(o - e);
  const denominator = Math.max(Math.abs(e), Number.EPSILON);
  return { valid: true, error, relativeError: error / denominator, score: error <= t ? 1 : Math.max(0, 1 - error / denominator) };
}

export function analyzeThroughput(samples = []) {
  const values = samples.map(Number).filter(Number.isFinite).filter(v => v >= 0);
  if (!values.length) return { count: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a,b) => a-b);
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    count: values.length,
    mean: values.reduce((a,b) => a+b, 0) / values.length,
    median: percentile(.5),
    p95: percentile(.95),
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

export function compareAlgorithms(results = []) {
  return [...results].filter(r => Number.isFinite(Number(r.score)))
    .sort((a,b) => Number(b.score) - Number(a.score))
    .map((r, rank) => ({ ...r, rank: rank + 1 }));
}
