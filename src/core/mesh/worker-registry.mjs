import crypto from "node:crypto";

export class WorkerRegistry {
  constructor() { this.workers = new Map(); }
  register(worker) {
    const id = worker.id ?? crypto.randomUUID();
    const record = { id, status: "idle", registeredAt: Date.now(), ...worker };
    this.workers.set(id, record);
    return record;
  }
  heartbeat(id, patch = {}) {
    const worker = this.workers.get(id);
    if (!worker) throw new Error("Unknown worker.");
    Object.assign(worker, patch, { lastHeartbeatAt: Date.now() });
    return worker;
  }
  remove(id) { return this.workers.delete(id); }
  list() { return [...this.workers.values()]; }
  status() {
    const workers = this.list();
    return { total: workers.length, online: workers.filter(w => w.status !== "offline").length, workers };
  }
}
export default WorkerRegistry;
