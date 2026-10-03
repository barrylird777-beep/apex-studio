export class MeshMetrics {
  constructor() { this.counters = new Map(); this.timings = []; }
  increment(name, value = 1) { this.counters.set(name, (this.counters.get(name) ?? 0) + value); }
  observe(name, ms) { this.timings.push({ name, ms: Number(ms) || 0, at: Date.now() }); if (this.timings.length > 1000) this.timings.shift(); }
  snapshot() { return { counters: Object.fromEntries(this.counters), timings: [...this.timings] }; }
}
export default MeshMetrics;
