export class WorkerHealth {
  constructor({ staleAfterMs = 30000 } = {}) { this.staleAfterMs = staleAfterMs; }
  inspect(worker, now = Date.now()) {
    const last = Number(worker.lastHeartbeatAt ?? worker.registeredAt ?? 0);
    const healthy = worker.status !== "offline" && now - last <= this.staleAfterMs;
    return { id: worker.id, healthy, ageMs: Math.max(0, now - last) };
  }
  inspectAll(workers, now = Date.now()) { return workers.map(w => this.inspect(w, now)); }
}
export default WorkerHealth;
