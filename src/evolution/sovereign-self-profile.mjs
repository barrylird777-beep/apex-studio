import { createHash, verify } from 'node:crypto';

export class SovereignSelfProfiler {
  constructor({ sample = 1000, propertyTest = async () => true, verifier = verify } = {}) {
    this.sample = Math.max(1, sample);
    this.propertyTest = propertyTest;
    this.verifier = verifier;
    this.samples = [];
  }
  record(name, durationNs, metadata = {}) {
    this.samples.push({ name, durationNs: String(durationNs), metadata });
    if (this.samples.length > this.sample) this.samples.shift();
  }
  profile() {
    const grouped = new Map();
    for (const sample of this.samples) {
      const list = grouped.get(sample.name) || [];
      list.push(BigInt(sample.durationNs));
      grouped.set(sample.name, list);
    }
    return [...grouped].map(([name, values]) => ({
      name,
      count: values.length,
      minNs: String(values.reduce((a,b) => a < b ? a : b)),
      maxNs: String(values.reduce((a,b) => a > b ? a : b))
    }));
  }
  async validatePatch({ bytes, signature, publicKey, properties }) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!this.verifier(null, bytes, publicKey, signature)) throw new Error('patch signature invalid');
    if (!await this.propertyTest(properties)) throw new Error('patch property tests failed');
    return { digest, validated: true };
  }
}
