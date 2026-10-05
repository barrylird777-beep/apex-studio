import crypto from "node:crypto";

const TYPES = new Set(["reasoning","research","coding","creative","media","knowledge","operations","verification","tool"]);
const id = () => crypto.randomUUID();

function list(v) { return Array.isArray(v) ? [...new Set(v.map(String))] : []; }
function score(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }

export class CapabilityRegistry {
  constructor() { this.capabilities = new Map(); this.versions = new Map(); }

  register(definition) {
    if (!definition || typeof definition.name !== "string" || !definition.name.trim()) throw new TypeError("Capability name is required");
    const name = definition.name.trim();
    const type = definition.type ?? "operations";
    if (!TYPES.has(type)) throw new TypeError("Unsupported capability type: " + type);
    if (typeof definition.execute !== "function") throw new TypeError("Capability execute() is required");
    const version = String(definition.version ?? "1.0.0");
    const record = Object.freeze({
      id: definition.id ?? id(), name, version, type,
      description: String(definition.description ?? ""),
      requires: list(definition.requires),
      tools: list(definition.tools),
      providers: list(definition.providers),
      permissions: list(definition.permissions),
      tags: list(definition.tags),
      quality: score(definition.quality, 0.5),
      latency: Math.max(0, Number(definition.latency ?? 0)),
      cost: Math.max(0, Number(definition.cost ?? 0)),
      execute: definition.execute,
      verify: typeof definition.verify === "function" ? definition.verify : null,
      registeredAt: new Date().toISOString()
    });
    this.capabilities.set(name, record);
    if (!this.versions.has(name)) this.versions.set(name, new Map());
    this.versions.get(name).set(version, record);
    return this.describe(name);
  }

  unregister(name) { return this.capabilities.delete(name); }
  get(name) { return this.capabilities.get(String(name)) ?? null; }
  list() { return [...this.capabilities.values()].map(this._public); }
  versionsOf(name) { return [...(this.versions.get(String(name))?.values() ?? [])].map(this._public); }

  resolve(requirements = {}) {
    const wanted = list(requirements.capabilities ?? requirements.names);
    const tags = new Set(list(requirements.tags));
    const tools = new Set(list(requirements.tools));
    const type = requirements.type ? String(requirements.type) : null;
    const candidates = [...this.capabilities.values()].filter(c =>
      (!type || c.type === type) &&
      wanted.every(n => c.name === n || c.tags.includes(n)) &&
      [...tags].every(t => c.tags.includes(t)) &&
      [...tools].every(t => c.tools.includes(t))
    );
    return candidates.sort((a,b) => this._score(b, requirements) - this._score(a, requirements)).map(this._public);
  }

  dependencyOrder(names) {
    const wanted = list(names);
    const visiting = new Set(), visited = new Set(), out = [];
    const visit = name => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error("Capability dependency cycle at " + name);
      const c = this.get(name);
      if (!c) throw new Error("Capability not registered: " + name);
      visiting.add(name);
      c.requires.forEach(visit);
      visiting.delete(name); visited.add(name); out.push(name);
    };
    wanted.forEach(visit);
    return out;
  }

  _score(c, req) {
    const qualityWeight = Number(req.qualityWeight ?? 1);
    const latencyWeight = Number(req.latencyWeight ?? 0.15);
    const costWeight = Number(req.costWeight ?? 0.1);
    return c.quality * qualityWeight - Math.min(c.latency / 10000, 1) * latencyWeight - Math.min(c.cost, 1) * costWeight;
  }

  _public(c) {
    const { execute, verify, ...safe } = c;
    return safe;
  }
}

export function createCapabilityRegistry(definitions = []) {
  const registry = new CapabilityRegistry();
  definitions.forEach(def => registry.register(def));
  return registry;
}
