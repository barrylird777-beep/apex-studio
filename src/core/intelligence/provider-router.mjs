import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const arr = v => Array.isArray(v) ? [...new Set(v.map(String))] : [];

export class ProviderRouter {
  constructor() { this.providers = new Map(); this.health = new Map(); }

  register(definition) {
    if (!definition || typeof definition.name !== "string") throw new TypeError("Provider name is required");
    if (!definition.adapter || typeof definition.adapter.generate !== "function") throw new TypeError("Provider adapter.generate() is required");
    const p = {
      id: definition.id ?? id(), name: definition.name, adapter: definition.adapter,
      capabilities: arr(definition.capabilities), models: arr(definition.models),
      maxConcurrency: Math.max(1, Number(definition.maxConcurrency ?? 1)),
      quality: Math.max(0, Math.min(1, Number(definition.quality ?? 0.5))),
      latency: Math.max(0, Number(definition.latency ?? 0)),
      cost: Math.max(0, Number(definition.cost ?? 0)),
      enabled: definition.enabled !== false
    };
    this.providers.set(p.name, p);
    this.health.set(p.name, { failures: 0, successes: 0, cooldownUntil: 0, lastError: null });
    return this.describe(p.name);
  }

  disable(name, reason = "disabled") {
    const p = this.providers.get(name); if (!p) return false;
    p.enabled = false; const h = this.health.get(name); h.lastError = reason; return true;
  }

  enable(name) { const p = this.providers.get(name); if (!p) return false; p.enabled = true; return true; }

  candidates(requirements = {}) {
    const capabilities = new Set(arr(requirements.capabilities));
    const now = Date.now();
    return [...this.providers.values()]
      .filter(p => p.enabled && (this.health.get(p.name)?.cooldownUntil ?? 0) <= now)
      .filter(p => [...capabilities].every(c => p.capabilities.includes(c)))
      .sort((a,b) => this.score(b, requirements) - this.score(a, requirements))
      .map(p => this.describe(p.name));
  }

  score(p, req = {}) {
    const h = this.health.get(p.name) ?? {};
    const quality = p.quality * Number(req.qualityWeight ?? 1);
    const latency = Math.min(p.latency / 10000, 1) * Number(req.latencyWeight ?? 0.2);
    const cost = Math.min(p.cost, 1) * Number(req.costWeight ?? 0.1);
    const failures = Math.min((h.failures ?? 0) / 10, 1) * Number(req.reliabilityWeight ?? 0.5);
    return quality - latency - cost - failures;
  }

  async generate(input, options = {}) {
    const candidates = this.candidates(options);
    if (!candidates.length) throw new Error("No healthy provider satisfies requested capabilities");
    const failures = [];
    for (const candidate of candidates) {
      try {
        const started = Date.now();
        const result = await this.providers.get(candidate.name).adapter.generate(input, options);
        const h = this.health.get(candidate.name); h.successes++; h.failures = Math.max(0, h.failures - 1); h.lastLatency = Date.now() - started;
        return { provider: candidate.name, result, latencyMs: h.lastLatency, attempts: failures.length + 1 };
      } catch (error) {
        const h = this.health.get(candidate.name); h.failures++; h.lastError = String(error?.message ?? error);
        h.cooldownUntil = Date.now() + Math.min(60000, 250 * 2 ** Math.min(h.failures, 8));
        failures.push({ provider: candidate.name, error: h.lastError });
      }
    }
    throw new AggregateError(failures.map(x => new Error(x.provider + ": " + x.error)), "All eligible providers failed");
  }

  describe(name) {
    const p = this.providers.get(name); if (!p) return null;
    const h = this.health.get(name) ?? {};
    return { id:p.id,name:p.name,capabilities:[...p.capabilities],models:[...p.models],maxConcurrency:p.maxConcurrency,quality:p.quality,latency:p.latency,cost:p.cost,enabled:p.enabled,health:{...h} };
  }

  list() { return [...this.providers.keys()].map(name => this.describe(name)); }
}
